import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "./client";
import {
  accounts,
  comments,
  notifications,
  projects,
  sessions,
  subtasks,
  tasks,
  teamInvites,
  teamJoinRequests,
  teamMemberships,
  teams,
  users,
  verifications,
} from "./schema";
import { closeTestDb, setupTestDb } from "./testing";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[schema.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("数据库 schema", () => {
  let db: DbClient;
  let userSeq = 0;
  let teamSeq = 0;
  let emailSeq = 0;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    // setupTestDb 会重放迁移并 TRUNCATE 全部表，保证用例互不污染。
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function createUser(username: string) {
    const id = crypto.randomUUID();
    const uid = generateUid();
    emailSeq += 1;
    await db.insert(users).values({
      id,
      uid,
      username,
      name: username,
      email: `user-${emailSeq}@example.com`,
      displayUsername: username,
    });
    return { id, uid };
  }

  async function createTeam(ownerId: string) {
    teamSeq += 1;
    const id = crypto.randomUUID();
    const joinCode = generateJoinCode();
    await db.insert(teams).values({
      id,
      name: `测试团队 ${teamSeq}`,
      slug: `test-team-${teamSeq}`,
      ownerId,
      joinCode,
    });
    return { id, joinCode };
  }

  async function createTask(input: {
    createdById: string;
    assigneeId?: string | null;
    projectId?: string | null;
    spaceType?: "personal" | "team";
  }) {
    const id = crypto.randomUUID();
    await db.insert(tasks).values({
      id,
      projectId: input.projectId ?? null,
      spaceType: input.spaceType ?? "personal",
      title: "测试任务",
      status: "todo",
      assigneeId: input.assigneeId ?? null,
      createdById: input.createdById,
    });
    return { id };
  }

  it("① username / uid 唯一约束拒绝重复", async () => {
    const user = await createUser("alice");

    await expect(
      db.insert(users).values({
        uid: generateUid(),
        username: "alice",
        name: "alice",
        email: "duplicate-alice@example.com",
        displayUsername: "alice",
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(users).values({
        uid: user.uid,
        username: "bob",
        name: "bob",
        email: "duplicate-uid@example.com",
        displayUsername: "bob",
      }),
    ).rejects.toThrow();
  });

  it("用户名区分大小写（与 PG 精确匹配语义一致）", async () => {
    await createUser("alice");
    const second = await createUser("Alice");

    const [row] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, second.id));
    expect(row!.username).toBe("Alice");

    await expect(createUser("alice")).rejects.toThrow();
  });

  it("② projects 的 CHECK 拒绝 teamId / ownerId 双填或双空", async () => {
    userSeq += 1;
    const owner = await createUser(`owner_${userSeq}`);
    const team = await createTeam(owner.id);

    await expect(
      db
        .insert(projects)
        .values({ teamId: team.id, ownerId: owner.id, name: "双填项目", slug: "both" }),
    ).rejects.toThrow();

    await expect(
      db.insert(projects).values({ name: "无归属项目", slug: "neither" }),
    ).rejects.toThrow();
  });

  it("③ pending 邀请的部分唯一索引拒绝同 (team, invitee) 二次 pending", async () => {
    userSeq += 1;
    const inviter = await createUser(`inviter_${userSeq}`);
    const invitee = await createUser(`invitee_${userSeq}`);
    const team = await createTeam(inviter.id);

    const inviteId = crypto.randomUUID();
    await db.insert(teamInvites).values({
      id: inviteId,
      teamId: team.id,
      inviteeId: invitee.id,
      invitedById: inviter.id,
      status: "pending",
    });

    await expect(
      db.insert(teamInvites).values({
        id: crypto.randomUUID(),
        teamId: team.id,
        inviteeId: invitee.id,
        invitedById: inviter.id,
        status: "pending",
      }),
    ).rejects.toThrow();

    // 非 pending 记录不占用部分唯一索引，可再次发起 pending 邀请。
    await db.update(teamInvites).set({ status: "declined" }).where(eq(teamInvites.id, inviteId));
    await expect(
      db.insert(teamInvites).values({
        id: crypto.randomUUID(),
        teamId: team.id,
        inviteeId: invitee.id,
        invitedById: inviter.id,
        status: "pending",
      }),
    ).resolves.toBeDefined();
  });

  it("④ 通知幂等索引拒绝同 (user_id, task_id, type) 二次插入", async () => {
    userSeq += 1;
    const user = await createUser(`notify_${userSeq}`);
    const task = await createTask({ createdById: user.id, assigneeId: user.id });

    await db.insert(notifications).values({
      userId: user.id,
      type: "task_assigned",
      taskId: task.id,
    });

    await expect(
      db.insert(notifications).values({
        userId: user.id,
        type: "task_assigned",
        taskId: task.id,
      }),
    ).rejects.toThrow();

    // 同任务不同类型属于不同通知，允许写入。
    await expect(
      db.insert(notifications).values({
        userId: user.id,
        type: "task_commented",
        taskId: task.id,
      }),
    ).resolves.toBeDefined();

    // task_id 为 NULL 的行不占用部分唯一索引（WHERE task_id IS NOT NULL），
    // 同 (user, type) 可写入多条。
    await expect(
      db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: user.id,
        type: "team_invite",
        taskId: null,
      }),
    ).resolves.toBeDefined();
    await expect(
      db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: user.id,
        type: "team_invite",
        taskId: null,
      }),
    ).resolves.toBeDefined();
  });

  it("⑤ 删除项目级联清空 tasks / subtasks / comments / notifications", async () => {
    userSeq += 1;
    const owner = await createUser(`cascade_project_${userSeq}`);
    const team = await createTeam(owner.id);
    const project = { id: crypto.randomUUID() };
    await db
      .insert(projects)
      .values({ id: project.id, teamId: team.id, name: "级联项目", slug: "cascade-project" });

    const task = await createTask({
      createdById: owner.id,
      assigneeId: owner.id,
      projectId: project.id,
      spaceType: "team",
    });

    await db.insert(subtasks).values({ taskId: task.id, title: "子任务" });
    await db.insert(comments).values({ taskId: task.id, authorId: owner.id, content: "评论" });
    await db.insert(notifications).values({
      userId: owner.id,
      type: "task_assigned",
      projectId: project.id,
      taskId: task.id,
      actorId: owner.id,
    });

    await db.delete(projects).where(eq(projects.id, project.id));

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(subtasks)).toHaveLength(0);
    expect(await db.select().from(comments)).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("⑥ 删除团队级联清空 memberships / invites / projects", async () => {
    userSeq += 1;
    const owner = await createUser(`cascade_team_owner_${userSeq}`);
    const member = await createUser(`cascade_team_member_${userSeq}`);
    const team = await createTeam(owner.id);

    await db.insert(teamMemberships).values([
      { teamId: team.id, userId: owner.id, role: "owner" },
      { teamId: team.id, userId: member.id, role: "member" },
    ]);
    await db.insert(teamInvites).values({
      teamId: team.id,
      inviteeId: member.id,
      invitedById: owner.id,
      status: "pending",
    });
    await db
      .insert(projects)
      .values({ teamId: team.id, name: "团队项目", slug: "team-project" });

    await db.delete(teams).where(eq(teams.id, team.id));

    expect(await db.select().from(teamMemberships)).toHaveLength(0);
    expect(await db.select().from(teamInvites)).toHaveLength(0);
    expect(await db.select().from(projects)).toHaveLength(0);
  });

  it("⑦ 团队 join_code 非空且 8 位，join_code_enabled 默认开启", async () => {
    userSeq += 1;
    const owner = await createUser(`join_code_owner_${userSeq}`);
    const team = await createTeam(owner.id);

    const [row] = await db.select().from(teams).where(eq(teams.id, team.id));
    expect(row!.joinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(row!.joinCodeEnabled).toBe(true);
  });

  it("⑧ 同库两条团队 join_code 不冲突，重复 join_code 被唯一索引拒绝", async () => {
    userSeq += 1;
    const owner = await createUser(`join_code_unique_${userSeq}`);
    const first = await createTeam(owner.id);
    const second = await createTeam(owner.id);

    expect(first.joinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(second.joinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(first.joinCode).not.toBe(second.joinCode);

    await expect(
      db.insert(teams).values({
        name: "重复入群码团队",
        slug: "duplicate-join-code",
        ownerId: owner.id,
        joinCode: first.joinCode,
      }),
    ).rejects.toThrow();
  });

  it("⑨ pending 加入申请的部分唯一索引拒绝同 (team, user) 二次 pending", async () => {
    userSeq += 1;
    const owner = await createUser(`join_request_owner_${userSeq}`);
    const applicant = await createUser(`join_request_user_${userSeq}`);
    const team = await createTeam(owner.id);

    const requestId = crypto.randomUUID();
    await db
      .insert(teamJoinRequests)
      .values({ id: requestId, teamId: team.id, userId: applicant.id });

    await expect(
      db
        .insert(teamJoinRequests)
        .values({ id: crypto.randomUUID(), teamId: team.id, userId: applicant.id }),
    ).rejects.toThrow();

    // 终态不占用部分唯一索引，申请人可再次发起 pending 申请。
    await db
      .update(teamJoinRequests)
      .set({ status: "declined", respondedAt: new Date(), respondedById: owner.id })
      .where(eq(teamJoinRequests.id, requestId));
    await expect(
      db
        .insert(teamJoinRequests)
        .values({ id: crypto.randomUUID(), teamId: team.id, userId: applicant.id }),
    ).resolves.toBeDefined();
  });

  it("⑩ 删除团队级联清空 team_join_requests", async () => {
    userSeq += 1;
    const owner = await createUser(`join_request_cascade_owner_${userSeq}`);
    const applicant = await createUser(`join_request_cascade_user_${userSeq}`);
    const team = await createTeam(owner.id);

    await db.insert(teamJoinRequests).values({ teamId: team.id, userId: applicant.id });

    await db.delete(teams).where(eq(teams.id, team.id));

    expect(await db.select().from(teamJoinRequests)).toHaveLength(0);
  });

  it("⑪ defaultNow() 写入的 created_at 回读接近当前 UTC 时刻", async () => {
    const before = Date.now();
    const user = await createUser("tz_default_now");
    const after = Date.now();

    const [row] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, user.id));

    // timestamptz 存绝对时刻，defaultNow() 回读应接近当前时刻。
    const readback = row!.createdAt.getTime();
    expect(readback).toBeGreaterThanOrEqual(before - 2000);
    expect(readback).toBeLessThanOrEqual(after + 2000);
  });

  it("⑫ session.token 唯一约束拒绝重复 token", async () => {
    const user = await createUser("session_token_unique");
    const token = crypto.randomUUID();

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(
      db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    ).rejects.toThrow();
  });
});

describe("better-auth 表结构（schema 元数据）", () => {
  function columnsByName(table: Parameters<typeof getTableConfig>[0]) {
    const { columns } = getTableConfig(table);
    return new Map(columns.map((column) => [column.name, column]));
  }

  it("⑬ users 扩展 better-auth 字段、email 必填，且移除 password_hash / nickname", () => {
    const byName = columnsByName(users);

    const name = byName.get("name");
    expect(name).toBeDefined();
    expect(name!.notNull).toBe(true);
    expect(name!.getSQLType()).toBe("text");

    const emailVerified = byName.get("email_verified");
    expect(emailVerified).toBeDefined();
    expect(emailVerified!.notNull).toBe(true);
    expect(emailVerified!.getSQLType()).toBe("boolean");
    expect(emailVerified!.hasDefault).toBe(true);
    expect(emailVerified!.default).toBe(false);

    const image = byName.get("image");
    expect(image).toBeDefined();
    expect(image!.notNull).toBe(false);
    expect(image!.getSQLType()).toBe("text");

    const displayUsername = byName.get("display_username");
    expect(displayUsername).toBeDefined();
    expect(displayUsername!.notNull).toBe(true);
    expect(displayUsername!.getSQLType()).toBe("text");

    const updatedAt = byName.get("updated_at");
    expect(updatedAt).toBeDefined();
    expect(updatedAt!.notNull).toBe(true);
    expect(updatedAt!.getSQLType()).toBe("timestamp with time zone");
    expect(updatedAt!.hasDefault).toBe(true);

    const email = byName.get("email");
    expect(email).toBeDefined();
    expect(email!.notNull).toBe(true);
    expect(email!.isUnique).toBe(true);
    expect(email!.uniqueName).toBe("users_email_unique");

    // better-auth 将密码迁到 accounts.password；旧自研列必须消失。
    expect(byName.has("password_hash")).toBe(false);
    expect(byName.has("nickname")).toBe(false);
  });

  it("⑭ sessions / accounts / verifications 三表存在且列形状符合 better-auth 模型", () => {
    const sessionColumns = columnsByName(sessions);
    expect(sessionColumns.has("user_id")).toBe(true);
    expect(sessionColumns.get("user_id")!.notNull).toBe(true);
    expect(sessionColumns.has("expires_at")).toBe(true);
    expect(sessionColumns.get("expires_at")!.notNull).toBe(true);
    expect(sessionColumns.has("ip_address")).toBe(true);
    expect(sessionColumns.get("ip_address")!.notNull).toBe(false);
    expect(sessionColumns.has("user_agent")).toBe(true);
    expect(sessionColumns.get("user_agent")!.notNull).toBe(false);
    expect(sessionColumns.has("created_at")).toBe(true);
    expect(sessionColumns.has("updated_at")).toBe(true);

    const token = sessionColumns.get("token");
    expect(token).toBeDefined();
    expect(token!.notNull).toBe(true);
    expect(token!.isUnique).toBe(true);
    expect(token!.uniqueName).toBe("sessions_token_unique");

    const accountColumns = columnsByName(accounts);
    expect(accountColumns.has("account_id")).toBe(true);
    expect(accountColumns.get("account_id")!.notNull).toBe(true);
    expect(accountColumns.has("provider_id")).toBe(true);
    expect(accountColumns.get("provider_id")!.notNull).toBe(true);
    expect(accountColumns.has("password")).toBe(true);
    expect(accountColumns.get("password")!.notNull).toBe(false);
    expect(accountColumns.has("user_id")).toBe(true);

    const verificationColumns = columnsByName(verifications);
    expect(verificationColumns.has("identifier")).toBe(true);
    expect(verificationColumns.get("identifier")!.notNull).toBe(true);
    expect(verificationColumns.has("value")).toBe(true);
    expect(verificationColumns.get("value")!.notNull).toBe(true);
    expect(verificationColumns.has("expires_at")).toBe(true);
    expect(verificationColumns.get("expires_at")!.notNull).toBe(true);
    expect(verificationColumns.has("created_at")).toBe(true);
    expect(verificationColumns.has("updated_at")).toBe(true);

    const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).indexes.map((item) => item.config.name);

    expect(indexNames(sessions)).toContain("sessions_user_id_idx");
    expect(indexNames(accounts)).toContain("accounts_user_id_idx");
    expect(indexNames(verifications)).toContain("verifications_identifier_idx");
  });
});
