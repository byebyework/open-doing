import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { projects, tasks, teamMemberships, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamPermissionError, getMembership } from "../permissions";
import { createTeam } from "../service";
import { MemberError, leaveTeam, removeMember } from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[teams/members/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
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

/**
 * 上下文：owner + admin + member + 外人；member 名下：
 * - 本团队项目内的任务；
 * - 另一团队项目内的任务；
 * - 个人项目任务与零散个人任务（projectId 为空）。
 */
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

  const [teamProject] = await db
    .insert(projects)
    .values({ teamId: team.id, name: "团队项目", slug: "team-project" })
    .returning();

  // 另一个团队（outsider 创建）及其项目：member 的任务不应被清空。
  const otherTeam = await createTeam({ name: "外部团队" }, outsider.id, db);
  const [otherProject] = await db
    .insert(projects)
    .values({ teamId: otherTeam.id, name: "外部项目", slug: "other-project" })
    .returning();

  // 个人项目：同样不应被清空。
  const [personalProject] = await db
    .insert(projects)
    .values({ ownerId: member.id, name: "个人项目", slug: "personal-project" })
    .returning();

  const [teamTask] = await db
    .insert(tasks)
    .values({
      projectId: teamProject!.id,
      spaceType: "team",
      title: "团队任务",
      assigneeId: member.id,
      createdById: owner.id,
    })
    .returning();
  // 同团队项目内其他成员的任务：只清目标成员，不能误伤。
  const [peerTask] = await db
    .insert(tasks)
    .values({
      projectId: teamProject!.id,
      spaceType: "team",
      title: "管理员任务",
      assigneeId: admin.id,
      createdById: owner.id,
    })
    .returning();
  const [otherTeamTask] = await db
    .insert(tasks)
    .values({
      projectId: otherProject!.id,
      spaceType: "team",
      title: "外部团队任务",
      assigneeId: member.id,
      createdById: outsider.id,
    })
    .returning();
  const [personalTask] = await db
    .insert(tasks)
    .values({
      projectId: personalProject!.id,
      spaceType: "personal",
      title: "个人任务",
      assigneeId: member.id,
      createdById: member.id,
    })
    .returning();
  const [looseTask] = await db
    .insert(tasks)
    .values({
      projectId: null,
      spaceType: "personal",
      title: "零散个人任务",
      assigneeId: member.id,
      createdById: member.id,
    })
    .returning();

  return {
    owner,
    admin,
    member,
    outsider,
    team,
    otherTeam,
    teamProject: teamProject!,
    teamTask: teamTask!,
    peerTask: peerTask!,
    otherTeamTask: otherTeamTask!,
    personalTask: personalTask!,
    looseTask: looseTask!,
  };
}

/** 按 id 取任务，同时断言任务行仍然存在（退出只清责任人，不删任务）。 */
async function taskById(db: DbClient, id: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  expect(row).toBeDefined();
  return row!;
}

describe.skipIf(!hasTestDatabase)("成员移除 / 主动退出 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("admin 移除 member：删除成员关系，仅清空本团队项目内其任务责任人", async () => {
    const ctx = await seedTeam(db);

    await removeMember(
      { teamId: ctx.team.id, targetUserId: ctx.member.id, actorId: ctx.admin.id },
      db,
    );

    // 成员关系消失（Review Focus 1）。
    expect(await getMembership(ctx.team.id, ctx.member.id, db)).toBeNull();

    // 本团队项目内其任务仍在、责任人置空。
    const teamTask = await taskById(db, ctx.teamTask.id);
    expect(teamTask).toMatchObject({ title: "团队任务", assigneeId: null });

    // 同团队项目内其他成员的任务不受影响。
    expect((await taskById(db, ctx.peerTask.id)).assigneeId).toBe(ctx.admin.id);

    // 另一团队任务、个人项目任务、零散个人任务均不受影响（Review Focus 2）。
    expect((await taskById(db, ctx.otherTeamTask.id)).assigneeId).toBe(ctx.member.id);
    expect((await taskById(db, ctx.personalTask.id)).assigneeId).toBe(ctx.member.id);
    expect((await taskById(db, ctx.looseTask.id)).assigneeId).toBe(ctx.member.id);

    // 任务数不变：只清责任人，不删除任务。
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, [ctx.teamTask.id, ctx.peerTask.id]));
    expect(rows).toHaveLength(2);
  });

  it("移除后被移除人 getMembership 为 null；再次移除报「成员不存在或已退出」", async () => {
    const ctx = await seedTeam(db);

    await removeMember(
      { teamId: ctx.team.id, targetUserId: ctx.member.id, actorId: ctx.admin.id },
      db,
    );
    expect(await getMembership(ctx.team.id, ctx.member.id, db)).toBeNull();

    const error = await removeMember(
      { teamId: ctx.team.id, targetUserId: ctx.member.id, actorId: ctx.admin.id },
      db,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MemberError);
    expect(error).toMatchObject({ code: "NOT_FOUND", message: "成员不存在或已退出" });
  });

  it("admin 移除 owner 被拒：owner 须先转让（Review Focus 3）", async () => {
    const ctx = await seedTeam(db);

    await expect(
      removeMember(
        { teamId: ctx.team.id, targetUserId: ctx.owner.id, actorId: ctx.admin.id },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    // owner 成员关系保持不变。
    expect(await getMembership(ctx.team.id, ctx.owner.id, db)).not.toBeNull();
  });

  it("member 调 removeMember 被拒（Review Focus 5）", async () => {
    const ctx = await seedTeam(db);

    await expect(
      removeMember(
        { teamId: ctx.team.id, targetUserId: ctx.admin.id, actorId: ctx.member.id },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    expect(await getMembership(ctx.team.id, ctx.admin.id, db)).not.toBeNull();
    expect(await getMembership(ctx.team.id, ctx.member.id, db)).not.toBeNull();
  });

  it("owner 主动退出被拒：「请先转让团队或解散团队」", async () => {
    const ctx = await seedTeam(db);

    const error = await leaveTeam({ teamId: ctx.team.id, actorId: ctx.owner.id }, db).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TeamPermissionError);
    expect(error).toHaveProperty("message", "请先转让团队或解散团队");
    expect(await getMembership(ctx.team.id, ctx.owner.id, db)).not.toBeNull();
  });

  it("member 主动退出：成员关系消失，任务处理与移除语义一致", async () => {
    const ctx = await seedTeam(db);

    await leaveTeam({ teamId: ctx.team.id, actorId: ctx.member.id }, db);

    expect(await getMembership(ctx.team.id, ctx.member.id, db)).toBeNull();

    const teamTask = await taskById(db, ctx.teamTask.id);
    expect(teamTask).toMatchObject({ title: "团队任务", assigneeId: null });

    expect((await taskById(db, ctx.peerTask.id)).assigneeId).toBe(ctx.admin.id);
    expect((await taskById(db, ctx.otherTeamTask.id)).assigneeId).toBe(ctx.member.id);
    expect((await taskById(db, ctx.personalTask.id)).assigneeId).toBe(ctx.member.id);
    expect((await taskById(db, ctx.looseTask.id)).assigneeId).toBe(ctx.member.id);
  });

  it("非成员 leaveTeam 被拒（TeamPermissionError）", async () => {
    const ctx = await seedTeam(db);

    await expect(
      leaveTeam({ teamId: ctx.team.id, actorId: ctx.outsider.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    // 本团队项目任务责任人不因非法调用而改变。
    expect((await taskById(db, ctx.teamTask.id)).assigneeId).toBe(ctx.member.id);
  });
});
