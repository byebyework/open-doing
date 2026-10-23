import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { notifications, teamInvites, teamMemberships, teams, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamPermissionError, getMembership } from "../permissions";
import { createTeam, listTeamsForUser } from "../service";
import {
  InviteError,
  createInvite,
  listPendingSentInvites,
  listReceivedInvites,
  rescindInvite,
  respondToInvite,
} from "./service";

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

  it("接受：写入 member 成员关系、邀请置 accepted、通知邀请人、团队进入我的团队", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    const teamResult = await respondToInvite({ inviteId: invite.id, actorId: outsider.id, accept: true }, db);

    expect(teamResult.id).toBe(team.id);
    expect(await getMembership(team.id, outsider.id, db)).toMatchObject({
      role: "member",
      userId: outsider.id,
    });

    const [inviteRow] = await db.select().from(teamInvites).where(eq(teamInvites.id, invite.id));
    expect(inviteRow!.status).toBe("accepted");
    expect(inviteRow!.respondedAt).not.toBeNull();

    const accepted = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.id), eq(notifications.type, "team_invite")));
    expect(accepted.length).toBe(1);

    expect((await listTeamsForUser(outsider.id, db)).map((t) => t.id)).toContain(team.id);
  });

  it("拒绝：邀请置 declined、不建立成员关系、通知邀请人", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    await respondToInvite({ inviteId: invite.id, actorId: outsider.id, accept: false }, db);

    const [inviteRow] = await db.select().from(teamInvites).where(eq(teamInvites.id, invite.id));
    expect(inviteRow!.status).toBe("declined");
    expect(inviteRow!.respondedAt).not.toBeNull();
    expect(await getMembership(team.id, outsider.id, db)).toBeNull();
  });

  it("失效响应：已撤销 / 已响应 / 非本人 均返回「邀请不存在或已失效」", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    // 已撤销。
    await rescindInvite({ inviteId: invite.id, teamId: team.id, actorId: owner.id }, db);
    await expect(
      respondToInvite({ inviteId: invite.id, actorId: outsider.id, accept: true }, db),
    ).rejects.toMatchObject({ code: "INVALID", message: "邀请不存在或已失效" });

    // 已响应。
    const second = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);
    await respondToInvite({ inviteId: second.id, actorId: outsider.id, accept: true }, db);
    await expect(
      respondToInvite({ inviteId: second.id, actorId: outsider.id, accept: true }, db),
    ).rejects.toMatchObject({ code: "INVALID" });

    // 非本人：对另一待邀请人发出的邀请，用 outsider 的身份响应。
    const other = await createUser(db, "other");
    const third = await createInvite({ teamId: team.id, actorId: owner.id, uid: other.uid }, db);
    await expect(
      respondToInvite({ inviteId: third.id, actorId: outsider.id, accept: true }, db),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("团队解散后邀请行被级联删除，响应返回「邀请不存在或已失效」而非 500", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const invite = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);

    // 模拟解散团队：级联删除 teams 行（邀请随之删除）。
    await db.delete(teams).where(eq(teams.id, team.id));

    await expect(
      respondToInvite({ inviteId: invite.id, actorId: outsider.id, accept: true }, db),
    ).rejects.toBeInstanceOf(InviteError);
  });

  it("listReceivedInvites：pending 在前且带团队/邀请人/成员数", async () => {
    const { owner, admin, member, outsider, team } = await seedTeam(db);

    const first = await createInvite({ teamId: team.id, actorId: owner.id, uid: outsider.uid }, db);
    await respondToInvite({ inviteId: first.id, actorId: outsider.id, accept: true }, db);

    // 第二个团队的新 pending 邀请。
    const team2 = await createTeam({ name: "效率工程部" }, admin.id, db);
    await db.insert(teamMemberships).values({ teamId: team2.id, userId: member.id, role: "member" });
    await createInvite({ teamId: team2.id, actorId: admin.id, uid: outsider.uid }, db);

    const received = await listReceivedInvites(outsider.id, db);

    expect(received).toHaveLength(2);
    expect(received[0]!.invite.status).toBe("pending");
    expect(received[0]).toMatchObject({
      team: { id: team2.id, name: "效率工程部" },
      invitedBy: { id: admin.id },
      memberCount: 2,
    });
    expect(received[1]!.invite.status).toBe("accepted");
    // 团队 1：owner + admin + member + 刚接受邀请的 outsider。
    expect(received[1]).toMatchObject({ team: { id: team.id }, memberCount: 4 });
  });
});
