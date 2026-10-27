import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  notifications,
  teamJoinRequests,
  teamMemberships,
  teams,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamPermissionError, getMembership } from "../permissions";
import { createTeam } from "../service";
import {
  JoinError,
  cancelJoinRequest,
  createJoinRequest,
  getTeamJoinSettings,
  listMyJoinRequests,
  listTeamJoinRequests,
  resetJoinCode,
  respondToJoinRequest,
  setJoinCodeEnabled,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[teams/joins/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

async function createUser(
  db: DbClient,
  username: string,
): Promise<{ id: string; uid: string }> {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning({ id: users.id, uid: users.uid });
  return row!;
}

/** 上下文：owner + admin + member + 外部申请人。 */
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

/** 读取团队当前入群码（createTeam 随机生成，测试内直接改库以固定取值）。 */
async function joinCodeOf(db: DbClient, teamId: string): Promise<string> {
  const [row] = await db
    .select({ joinCode: teams.joinCode })
    .from(teams)
    .where(eq(teams.id, teamId));
  return row!.joinCode;
}

/** 通知计数（可选按类型过滤），用于断言「取消不产生通知」。 */
async function countNotifications(
  db: DbClient,
  type?: "team_join_requested" | "team_join_approved" | "team_join_declined",
): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(type ? eq(notifications.type, type) : undefined);
  return rows.length;
}

/** 读取某团队针对某申请人的「凭码申请」通知（审批人扇出的一组）。 */
async function joinRequestedNotifications(
  db: DbClient,
  teamId: string,
  applicantId: string,
) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "team_join_requested"),
        eq(notifications.teamId, teamId),
        eq(notifications.actorId, applicantId),
      ),
    );
}

describe.skipIf(!hasTestDatabase)("凭码加入 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("无效入群码：格式非法 / 不存在均抛 code 字段错误，且不泄露团队名", async () => {
    const { outsider, team } = await seedTeam(db);

    for (const code of ["", "ABC", "ZZZZZZZZ"]) {
      const error = await createJoinRequest({ code, actorId: outsider.id }, db).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(JoinError);
      expect(error).toMatchObject({ code: "CODE_INVALID", field: "code" });
      expect((error as Error).message).not.toContain(team.name);
    }
  });

  it("入群码归一化：前后空白 + 转大写后合法", async () => {
    const { outsider, team } = await seedTeam(db);
    await db.update(teams).set({ joinCode: "K7M29XQ4" }).where(eq(teams.id, team.id));

    const request = await createJoinRequest({ code: " k7m29xq4 ", actorId: outsider.id }, db);

    expect(request).toMatchObject({ teamId: team.id, userId: outsider.id, status: "pending" });
  });

  it("入群码归一化：粘贴码中间含空白也合法", async () => {
    const { outsider, team } = await seedTeam(db);
    await db.update(teams).set({ joinCode: "K7M29XQ4" }).where(eq(teams.id, team.id));

    const request = await createJoinRequest({ code: "k7m2 9xq4", actorId: outsider.id }, db);

    expect(request).toMatchObject({ teamId: team.id, userId: outsider.id, status: "pending" });
  });

  it("团队关闭凭码加入后申请报 JOIN_DISABLED", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);

    await setJoinCodeEnabled({ teamId: team.id, actorId: owner.id, enabled: false }, db);

    await expect(
      createJoinRequest({ code, actorId: outsider.id }, db),
    ).rejects.toMatchObject({ code: "JOIN_DISABLED", field: "code" });
  });

  it("已是成员（含团队创建者本人）报 ALREADY_MEMBER", async () => {
    const { owner, member, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);

    await expect(
      createJoinRequest({ code, actorId: owner.id }, db),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });

    await expect(
      createJoinRequest({ code, actorId: member.id }, db),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
  });

  it("已有 pending 申请时报 PENDING_EXISTS", async () => {
    const { outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);

    await createJoinRequest({ code, actorId: outsider.id }, db);

    await expect(
      createJoinRequest({ code, actorId: outsider.id }, db),
    ).rejects.toMatchObject({ code: "PENDING_EXISTS" });
  });

  it("成功：返回 pending 申请，owner/admin 各收一条通知，member 不收", async () => {
    const { owner, admin, member, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);

    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    expect(request).toMatchObject({
      teamId: team.id,
      userId: outsider.id,
      status: "pending",
    });
    expect(request.respondedAt).toBeUndefined();
    expect(request.respondedById).toBeUndefined();
    expect(Number.isNaN(Date.parse(request.createdAt))).toBe(false);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "team_join_requested"));
    expect(rows).toHaveLength(2);
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    expect(byUser.get(owner.id)).toMatchObject({
      teamId: team.id,
      actorId: outsider.id,
      taskId: null,
      read: false,
    });
    expect(byUser.get(admin.id)).toMatchObject({
      teamId: team.id,
      actorId: outsider.id,
      taskId: null,
      read: false,
    });
    expect(byUser.has(member.id)).toBe(false);
  });

  it("被拒绝后可再次申请成功", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);

    const first = await createJoinRequest({ code, actorId: outsider.id }, db);
    await respondToJoinRequest({ requestId: first.id, actorId: owner.id, approve: false }, db);

    const second = await createJoinRequest({ code, actorId: outsider.id }, db);
    expect(second.status).toBe("pending");
    expect(second.id).not.toBe(first.id);
  });

  it("批准：申请转 approved，写入 member 成员关系并通知申请人", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    const approved = await respondToJoinRequest(
      { requestId: request.id, actorId: owner.id, approve: true },
      db,
    );

    expect(approved).toMatchObject({
      id: request.id,
      status: "approved",
      respondedById: owner.id,
    });
    expect(approved.respondedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(approved.respondedAt!))).toBe(false);

    expect(await getMembership(team.id, outsider.id, db)).toMatchObject({
      userId: outsider.id,
      role: "member",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, outsider.id),
          eq(notifications.type, "team_join_approved"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: team.id, actorId: owner.id, taskId: null });
  });

  it("admin 也可批准加入申请", async () => {
    const { admin, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    const approved = await respondToJoinRequest(
      { requestId: request.id, actorId: admin.id, approve: true },
      db,
    );

    expect(approved).toMatchObject({ status: "approved", respondedById: admin.id });
    expect(await getMembership(team.id, outsider.id, db)).toMatchObject({ role: "member" });
  });

  it("拒绝：申请转 declined，不建成员关系并通知申请人", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    const declined = await respondToJoinRequest(
      { requestId: request.id, actorId: owner.id, approve: false },
      db,
    );

    expect(declined).toMatchObject({
      id: request.id,
      status: "declined",
      respondedById: owner.id,
    });
    expect(await getMembership(team.id, outsider.id, db)).toBeNull();

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, outsider.id),
          eq(notifications.type, "team_join_declined"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: team.id, actorId: owner.id });
  });

  it("非 owner/admin 审批抛 TeamPermissionError", async () => {
    const { member, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    await expect(
      respondToJoinRequest({ requestId: request.id, actorId: member.id, approve: true }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("非 pending（重复审批）与 requestId 不存在均抛 INVALID", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    await respondToJoinRequest({ requestId: request.id, actorId: owner.id, approve: true }, db);

    await expect(
      respondToJoinRequest({ requestId: request.id, actorId: owner.id, approve: true }, db),
    ).rejects.toMatchObject({ code: "INVALID" });

    await expect(
      respondToJoinRequest(
        { requestId: crypto.randomUUID(), actorId: owner.id, approve: true },
        db,
      ),
    ).rejects.toMatchObject({ code: "INVALID" });

    await expect(
      respondToJoinRequest({ requestId: "not-a-uuid", actorId: owner.id, approve: true }, db),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("批准撞成员唯一约束（邀请接受竞态）：ALREADY_MEMBER 且事务回滚、申请保持 pending", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    // 申请提交后，申请人同时接受了邀请 —— 成员关系先于审批落库。
    await db
      .insert(teamMemberships)
      .values({ teamId: team.id, userId: outsider.id, role: "member" });

    await expect(
      respondToJoinRequest({ requestId: request.id, actorId: owner.id, approve: true }, db),
    ).rejects.toMatchObject({ code: "ALREADY_MEMBER" });

    const [row] = await db
      .select()
      .from(teamJoinRequests)
      .where(eq(teamJoinRequests.id, request.id));
    expect(row!.status).toBe("pending");
    expect(row!.respondedAt).toBeNull();
    expect(row!.respondedById).toBeNull();

    // 没有产生「已通过」通知。
    expect(await countNotifications(db, "team_join_approved")).toBe(0);
  });

  it("取消：本人取消自己的 pending 转 cancelled，且不产生任何通知", async () => {
    const { outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    const before = await countNotifications(db);
    const cancelled = await cancelJoinRequest(
      { requestId: request.id, actorId: outsider.id },
      db,
    );

    expect(cancelled).toMatchObject({ id: request.id, status: "cancelled" });
    expect(await countNotifications(db)).toBe(before);
  });

  it("批准后清除审批人针对该申请人的未读申请通知", async () => {
    const { owner, admin, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    await respondToJoinRequest(
      { requestId: request.id, actorId: owner.id, approve: true },
      db,
    );

    const rows = await joinRequestedNotifications(db, team.id, outsider.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([owner.id, admin.id].sort());
    expect(rows.every((row) => row.read)).toBe(true);
  });

  it("拒绝后清除审批人针对该申请人的未读申请通知", async () => {
    const { owner, admin, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    await respondToJoinRequest(
      { requestId: request.id, actorId: owner.id, approve: false },
      db,
    );

    const rows = await joinRequestedNotifications(db, team.id, outsider.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([owner.id, admin.id].sort());
    expect(rows.every((row) => row.read)).toBe(true);
  });

  it("撤回后清除审批人针对该申请人的未读申请通知", async () => {
    const { owner, admin, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    await cancelJoinRequest({ requestId: request.id, actorId: outsider.id }, db);

    const rows = await joinRequestedNotifications(db, team.id, outsider.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([owner.id, admin.id].sort());
    expect(rows.every((row) => row.read)).toBe(true);
  });

  it("只清除被处理申请人的通知，其他申请人的待处理通知保持未读", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const second = await createUser(db, "second");
    const code = await joinCodeOf(db, team.id);
    const first = await createJoinRequest({ code, actorId: outsider.id }, db);
    await createJoinRequest({ code, actorId: second.id }, db);

    await respondToJoinRequest(
      { requestId: first.id, actorId: owner.id, approve: false },
      db,
    );

    const resolved = await joinRequestedNotifications(db, team.id, outsider.id);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every((row) => row.read)).toBe(true);

    const pending = await joinRequestedNotifications(db, team.id, second.id);
    expect(pending).toHaveLength(2);
    expect(pending.every((row) => row.read)).toBe(false);
  });

  it("取消他人申请或非 pending 抛 INVALID", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);

    await expect(
      cancelJoinRequest({ requestId: request.id, actorId: owner.id }, db),
    ).rejects.toMatchObject({ code: "INVALID" });

    await cancelJoinRequest({ requestId: request.id, actorId: outsider.id }, db);

    await expect(
      cancelJoinRequest({ requestId: request.id, actorId: outsider.id }, db),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("重置入群码：owner/admin 可操作，旧码失效、新码可用", async () => {
    const { owner, admin, outsider, team } = await seedTeam(db);
    const oldCode = await joinCodeOf(db, team.id);

    const newCode = await resetJoinCode({ teamId: team.id, actorId: owner.id }, db);
    expect(newCode).not.toBe(oldCode);
    expect(await joinCodeOf(db, team.id)).toBe(newCode);

    const adminCode = await resetJoinCode({ teamId: team.id, actorId: admin.id }, db);
    expect(adminCode).not.toBe(newCode);

    await expect(
      createJoinRequest({ code: oldCode, actorId: outsider.id }, db),
    ).rejects.toMatchObject({ code: "CODE_INVALID" });

    const request = await createJoinRequest({ code: adminCode, actorId: outsider.id }, db);
    expect(request.status).toBe("pending");
  });

  it("开关与重置的权限：member 抛 TeamPermissionError", async () => {
    const { member, team } = await seedTeam(db);

    await expect(
      resetJoinCode({ teamId: team.id, actorId: member.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await expect(
      setJoinCodeEnabled({ teamId: team.id, actorId: member.id, enabled: false }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("getTeamJoinSettings 返回入群码与开关状态；重新开启后可申请", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const code = await joinCodeOf(db, team.id);

    await expect(getTeamJoinSettings(team.id, db)).resolves.toEqual({
      joinCode: code,
      joinCodeEnabled: true,
    });

    await setJoinCodeEnabled({ teamId: team.id, actorId: owner.id, enabled: false }, db);
    expect((await getTeamJoinSettings(team.id, db)).joinCodeEnabled).toBe(false);

    await setJoinCodeEnabled({ teamId: team.id, actorId: owner.id, enabled: true }, db);
    const request = await createJoinRequest({ code, actorId: outsider.id }, db);
    expect(request.status).toBe("pending");
  });

  it("listTeamJoinRequests：全状态、createdAt 升序、带申请人信息与 ISO 时间", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const second = await createUser(db, "second");

    await db.insert(teamJoinRequests).values([
      {
        teamId: team.id,
        userId: outsider.id,
        status: "pending",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        teamId: team.id,
        userId: second.id,
        status: "declined",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        respondedAt: new Date("2026-01-03T00:00:00Z"),
        respondedById: owner.id,
      },
    ]);

    const list = await listTeamJoinRequests(team.id, db);

    expect(list.map((view) => view.user.username)).toEqual(["second", "outsider"]);
    expect(list[0]).toMatchObject({
      request: {
        userId: second.id,
        status: "declined",
        createdAt: "2026-01-01T00:00:00.000Z",
        respondedAt: "2026-01-03T00:00:00.000Z",
        respondedById: owner.id,
      },
      user: { id: second.id, uid: second.uid, username: "second" },
    });
    expect(list[1]).toMatchObject({
      request: { status: "pending", createdAt: "2026-01-02T00:00:00.000Z" },
      user: { id: outsider.id },
    });
    expect(list[1]!.request.respondedAt).toBeUndefined();
  });

  it("listMyJoinRequests：全状态、createdAt 升序、带团队信息与 ISO 时间", async () => {
    const { owner, outsider, team } = await seedTeam(db);
    const team2 = await createTeam({ name: "效率工程部" }, owner.id, db);

    await db.insert(teamJoinRequests).values([
      {
        teamId: team.id,
        userId: outsider.id,
        status: "pending",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        teamId: team2.id,
        userId: outsider.id,
        status: "approved",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        respondedAt: new Date("2026-01-04T00:00:00Z"),
        respondedById: owner.id,
      },
    ]);

    const mine = await listMyJoinRequests(outsider.id, db);

    expect(mine.map((view) => view.team.name)).toEqual(["效率工程部", "增长突击队"]);
    expect(mine[0]).toMatchObject({
      request: {
        teamId: team2.id,
        status: "approved",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      team: { id: team2.id, name: "效率工程部", slug: team2.slug },
    });
    expect(mine[1]).toMatchObject({
      request: { teamId: team.id, status: "pending" },
      team: { id: team.id, name: "增长突击队", slug: team.slug },
    });
  });
});
