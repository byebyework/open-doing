import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { notifications, teamInvites, teamMemberships, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamPermissionError, getMembership } from "../permissions";
import { createTeam } from "../service";
import { InviteError, createInvite, listPendingSentInvites, rescindInvite } from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[teams/invites/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

async function createUser(db: DbClient, username: string): Promise<{ id: string; uid: string }> {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning({ id: users.id, uid: users.uid });
  return row!;
}

/** 上下文：owner + admin + member + 外部待邀请人。 */
async function seedTeam(db: DbClient) {
  const owner = await createUser(db, "owner");
  const admin = await createUser(db, "admin");
  const member = await createUser(db, "member");
  const outsider = await createUser(db, "outsider");

  const team = await createTeam({ name: "增长突击队" }, owner.id, db);
  await db.insert(teamMemberships).values([
    { teamId: team.id, userId: admin.id, role: "admin" },
    { teamId: team.id, userId: member.id, role: "member" },
  ]);

  return { owner, admin, member, outsider, team };
}

describe.skipIf(!hasTestDatabase)("邀请 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("owner/admin 可发起邀请，member 被拒", async () => {
    const { owner, admin, member, outsider, team } = await seedTeam(db);

    await expect(
      createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db),
    ).resolves.toMatchObject({ teamId: team.id, inviteeId: outsider.id, status: "pending" });

    await expect(
      createInvite({ teamId: team.id, actorId: admin.id, uid: outsider.uid }, db),
    ).rejects.toMatchObject({ code: "PENDING_EXISTS" });

    await expect(
      createInvite({ teamId: team.id, actorId: member.id, uid: outsider.uid }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("UID 无效：空 / 非 doing_ 前缀 / 不存在 均抛 uid 字段错误「UID 无效」", async () => {
    const { owner, team } = await seedTeam(db);

    for (const uid of ["", "not-doing", "doing_zzzzzz"]) {
      const error = await createInvite({ teamId: team.id, actorId: owner.id, uid }, db).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(InviteError);
      expect(error).toMatchObject({ code: "UID_NOT_FOUND", field: "uid", message: "UID 无效" });
    }
  });

  it("不能邀请自己，已是成员拒绝并给出友好错误", async () => {
    const { owner, admin, team } = await seedTeam(db);

    await expect(
      createInvite({ teamId: team.id, actorId: owner.id, uid: owner.uid }, db),
    ).rejects.toMatchObject({ code: "SELF" });

    await expect(
      createInvite({ teamId: team.id, actorId: owner.id, uid: admin.uid }, db),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
  });

  it("重复 pending 邀请：service 拒绝；绕过 service 直插第二条被部分唯一索引拒绝", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    await expect(
      createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db),
    ).rejects.toMatchObject({ code: "PENDING_EXISTS" });

    // 数据库兜底：直接插入第二条 pending 应触发 23505。
    await expect(
      db.insert(teamInvites).values({
        teamId: team.id,
        inviteeId: outsider.id,
        invitedById: owner.id,
        status: "pending",
      }),
    ).rejects.toThrow();
  });

  it("邀请落库后同事务写入 team_invite 通知（INT-1 核验点）", async () => {
    const { owner, outsider, team } = await seedTeam(db);

    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, outsider.id), eq(notifications.type, "team_invite")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: team.id, actorId: owner.id, read: false });

    expect(invite.id).toBeTruthy();
    expect(invite.respondedAt).toBeUndefined();
  });

  it("撤销：pending -> rescinded 并通知被邀请人，respondedAt 保持空", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    const rescinded = await rescindInvite({ inviteId: invite.id, teamId: team.id, actorId: owner.id }, db);

    expect(rescinded).toMatchObject({ status: "rescinded" });
    expect(rescinded.respondedAt).toBeUndefined();

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, outsider.id), eq(notifications.type, "team_invite")));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("撤销约束：非 pending 不可撤销，member 撤销被拒", async () => {
    const { owner, member, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    await expect(
      rescindInvite({ inviteId: invite.id, teamId: team.id, actorId: member.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await rescindInvite({ inviteId: invite.id, teamId: team.id, actorId: owner.id }, db);
    await expect(
      rescindInvite({ inviteId: invite.id, teamId: team.id, actorId: owner.id }, db),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("listPendingSentInvites：返回待处理邀请与被邀请人信息", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    const sent = await listPendingSentInvites(team.id, db);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      invite: { id: invite.id, status: "pending" },
      invitee: { id: outsider.id, uid: outsider.uid, username: "outsider" },
    });
  });

  it("已接受成员的成员关系不受邀请流程影响（一致性冒烟）", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    expect(await getMembership(team.id, outsider.id, db)).toBeNull();
  });
});
