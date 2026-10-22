import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "./client";
import {
  comments,
  notifications,
  projects,
  subtasks,
  tasks,
  teamInvites,
  teamMemberships,
  teams,
  users,
} from "./schema";
import { closeTestDb, setupTestDb } from "./testing";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[schema.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=postgres://open-doing:open-doing@localhost:5432/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("数据库 schema", () => {
  let db: DbClient;
  let userSeq = 0;
  let teamSeq = 0;

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
    const [row] = await db
      .insert(users)
      .values({ uid: generateUid(), username, passwordHash: "test-hash" })
      .returning({ id: users.id, uid: users.uid });
    return row;
  }

  async function createTeam(ownerId: string) {
    teamSeq += 1;
    const [row] = await db
      .insert(teams)
      .values({ name: `测试团队 ${teamSeq}`, slug: `test-team-${teamSeq}`, ownerId })
      .returning({ id: teams.id });
    return row;
  }

  async function createTask(input: {
    createdById: string;
    assigneeId?: string | null;
    projectId?: string | null;
    spaceType?: "personal" | "team";
  }) {
    const [row] = await db
      .insert(tasks)
      .values({
        projectId: input.projectId ?? null,
        spaceType: input.spaceType ?? "personal",
        title: "测试任务",
        status: "todo",
        assigneeId: input.assigneeId ?? null,
        createdById: input.createdById,
      })
      .returning({ id: tasks.id });
    return row;
  }

  it("① username / uid 唯一约束拒绝重复", async () => {
    const user = await createUser("alice");

    await expect(
      db.insert(users).values({ uid: generateUid(), username: "alice", passwordHash: "hash" }),
    ).rejects.toThrow();

    await expect(
      db.insert(users).values({ uid: user.uid, username: "bob", passwordHash: "hash" }),
    ).rejects.toThrow();
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

    const [invite] = await db
      .insert(teamInvites)
      .values({
        teamId: team.id,
        inviteeId: invitee.id,
        invitedById: inviter.id,
        status: "pending",
      })
      .returning({ id: teamInvites.id });

    await expect(
      db.insert(teamInvites).values({
        teamId: team.id,
        inviteeId: invitee.id,
        invitedById: inviter.id,
        status: "pending",
      }),
    ).rejects.toThrow();

    // 非 pending 记录不占用部分唯一索引，可再次发起 pending 邀请。
    await db.update(teamInvites).set({ status: "declined" }).where(eq(teamInvites.id, invite.id));
    await expect(
      db.insert(teamInvites).values({
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
  });

  it("⑤ 删除项目级联清空 tasks / subtasks / comments / notifications", async () => {
    userSeq += 1;
    const owner = await createUser(`cascade_project_${userSeq}`);
    const team = await createTeam(owner.id);
    const [project] = await db
      .insert(projects)
      .values({ teamId: team.id, name: "级联项目", slug: "cascade-project" })
      .returning({ id: projects.id });

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
});
