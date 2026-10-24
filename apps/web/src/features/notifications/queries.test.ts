import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { notifications, projects, tasks, teams, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  buildNotificationHref,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markTeamInviteNotificationsRead,
} from "./queries";
import { createNotification } from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[notifications/queries.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

async function createUser(db: DbClient, username: string) {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning({ id: users.id, uid: users.uid, username: users.username });
  return row!;
}

/** 造数上下文：owner + member、一团队（含项目/任务），以及 member 的个人任务。 */
async function seed(db: DbClient) {
  const owner = await createUser(db, "owner");
  const member = await createUser(db, "member");

  const [team] = await db
    .insert(teams)
    .values({ name: "增长突击队", slug: "growth-squad", ownerId: owner.id })
    .returning();
  const [teamProject] = await db
    .insert(projects)
    .values({ teamId: team!.id, name: "官网改版", slug: "website-revamp" })
    .returning();
  const [teamTask] = await db
    .insert(tasks)
    .values({
      projectId: teamProject!.id,
      spaceType: "team",
      title: "上线落地页",
      createdById: owner.id,
      assigneeId: member.id,
    })
    .returning();
  const [personalTask] = await db
    .insert(tasks)
    .values({
      spaceType: "personal",
      title: "写周报",
      createdById: member.id,
      assigneeId: member.id,
    })
    .returning();

  return { owner, member, team: team!, teamProject: teamProject!, teamTask: teamTask!, personalTask: personalTask! };
}

describe.skipIf(!hasTestDatabase)("通知查询与已读 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("getUnreadNotificationCount 只统计本人未读条数", async () => {
    const { owner, member, team, teamProject, teamTask, personalTask } = await seed(db);

    await createNotification({ userId: member.id, type: "team_invite", teamId: team.id, actorId: owner.id }, db);
    await createNotification(
      {
        userId: member.id,
        type: "task_assigned",
        teamId: team.id,
        projectId: teamProject.id,
        taskId: teamTask.id,
        actorId: owner.id,
      },
      db,
    );
    await createNotification(
      { userId: member.id, type: "task_due_soon", taskId: personalTask.id, read: true },
      db,
    );
    await createNotification({ userId: owner.id, type: "team_invite", teamId: team.id, actorId: member.id }, db);

    expect(await getUnreadNotificationCount(member.id, db)).toBe(2);
    expect(await getUnreadNotificationCount(owner.id, db)).toBe(1);
  });

  it("listNotifications 按 createdAt 降序并受 limit 限制", async () => {
    const { owner, member, personalTask } = await seed(db);
    const base = new Date("2026-10-01T00:00:00Z").getTime();

    // 显式写入 createdAt，保证排序断言稳定。
    await db.insert(notifications).values([
      {
        userId: member.id,
        type: "task_overdue",
        taskId: personalTask.id,
        createdAt: new Date(base + 1000),
      },
      {
        userId: member.id,
        type: "task_commented",
        taskId: personalTask.id,
        createdAt: new Date(base + 2000),
      },
      {
        userId: member.id,
        type: "task_changed_by_admin",
        taskId: personalTask.id,
        createdAt: new Date(base + 3000),
      },
      {
        userId: owner.id,
        type: "task_overdue",
        taskId: personalTask.id,
        createdAt: new Date(base + 4000),
      },
    ]);

    const limited = await listNotifications({ userId: member.id, limit: 2 }, db);
    expect(limited.map((item) => item.type)).toEqual(["task_changed_by_admin", "task_commented"]);
    expect(limited.map((item) => item.id)).toHaveLength(2);

    const all = await listNotifications({ userId: member.id }, db);
    expect(all.map((item) => item.type)).toEqual([
      "task_changed_by_admin",
      "task_commented",
      "task_overdue",
    ]);
  });

  it("listNotifications：team_invite 条目带 /invites、团队名与触发者用户名", async () => {
    const { owner, member, team } = await seed(db);
    await createNotification({ userId: member.id, type: "team_invite", teamId: team.id, actorId: owner.id }, db);

    const [item] = await listNotifications({ userId: member.id }, db);

    expect(item).toMatchObject({
      type: "team_invite",
      read: false,
      actorName: "owner",
      teamName: "增长突击队",
      taskTitle: null,
      href: "/invites",
    });
    expect(new Date(item!.createdAt).toISOString()).toBe(item!.createdAt);
  });

  it("listNotifications：团队任务 href 含团队/项目 slug 与任务 id，个人任务为 /my/tasks/{id}", async () => {
    const { owner, member, team, teamProject, teamTask, personalTask } = await seed(db);

    await createNotification(
      {
        userId: member.id,
        type: "task_assigned",
        teamId: team.id,
        projectId: teamProject.id,
        taskId: teamTask.id,
        actorId: owner.id,
      },
      db,
    );
    // 系统产生（cron）通知没有 actorId。
    await createNotification({ userId: member.id, type: "task_overdue", taskId: personalTask.id }, db);

    const items = await listNotifications({ userId: member.id }, db);
    const byType = new Map(items.map((item) => [item.type, item]));

    expect(byType.get("task_assigned")).toMatchObject({
      actorName: "owner",
      teamName: "增长突击队",
      taskTitle: "上线落地页",
      href: `/teams/growth-squad/projects/website-revamp/tasks/${teamTask.id}`,
    });
    expect(byType.get("task_overdue")).toMatchObject({
      actorName: null,
      teamName: null,
      taskTitle: "写周报",
      href: `/my/tasks/${personalTask.id}`,
    });
  });

  it("markNotificationRead：本人置已读返回 true；他人 / 不存在返回 false 且不落库", async () => {
    const { owner, member, team } = await seed(db);
    await createNotification({ userId: member.id, type: "team_invite", teamId: team.id, actorId: owner.id }, db);
    await createNotification({ userId: owner.id, type: "team_invite", teamId: team.id, actorId: member.id }, db);

    const [mine] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, member.id), eq(notifications.type, "team_invite")));
    const [others] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.id), eq(notifications.type, "team_invite")));

    expect(await markNotificationRead({ userId: member.id, notificationId: mine!.id }, db)).toBe(true);
    const [readRow] = await db.select().from(notifications).where(eq(notifications.id, mine!.id));
    expect(readRow!.read).toBe(true);

    expect(await markNotificationRead({ userId: member.id, notificationId: others!.id }, db)).toBe(false);
    const [untouched] = await db.select().from(notifications).where(eq(notifications.id, others!.id));
    expect(untouched!.read).toBe(false);

    expect(
      await markNotificationRead({ userId: member.id, notificationId: crypto.randomUUID() }, db),
    ).toBe(false);
  });

  it("markAllNotificationsRead：只动本人并返回条数，二次调用返回 0", async () => {
    const { owner, member, team, personalTask } = await seed(db);
    await createNotification({ userId: member.id, type: "team_invite", teamId: team.id, actorId: owner.id }, db);
    await createNotification({ userId: member.id, type: "task_overdue", taskId: personalTask.id }, db);
    await createNotification({ userId: owner.id, type: "team_invite", teamId: team.id, actorId: member.id }, db);

    expect(await markAllNotificationsRead(member.id, db)).toBe(2);
    expect(await getUnreadNotificationCount(member.id, db)).toBe(0);
    expect(await getUnreadNotificationCount(owner.id, db)).toBe(1);

    expect(await markAllNotificationsRead(member.id, db)).toBe(0);
  });

  it("markTeamInviteNotificationsRead：只置团队邀请通知为已读", async () => {
    const { owner, member, team, personalTask } = await seed(db);
    const [otherTeam] = await db
      .insert(teams)
      .values({ name: "效率工程部", slug: "efficiency-lab", ownerId: owner.id })
      .returning();

    await createNotification({ userId: member.id, type: "team_invite", teamId: team.id, actorId: owner.id }, db);
    await createNotification(
      { userId: member.id, type: "team_invite", teamId: otherTeam!.id, actorId: owner.id },
      db,
    );
    await createNotification({ userId: member.id, type: "task_overdue", taskId: personalTask.id }, db);

    await markTeamInviteNotificationsRead({ userId: member.id, teamId: team.id }, db);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, member.id));
    expect(rows.find((row) => row.type === "team_invite" && row.teamId === team.id)?.read).toBe(true);
    expect(rows.find((row) => row.type === "team_invite" && row.teamId === otherTeam!.id)?.read).toBe(false);
    expect(rows.find((row) => row.type === "task_overdue")?.read).toBe(false);
  });
});

describe("buildNotificationHref", () => {
  const cases: {
    name: string;
    item: Parameters<typeof buildNotificationHref>[0];
    expected: string | null;
  }[] = [
    {
      name: "team_invite 一律指向 /invites（无需其他参数）",
      item: { type: "team_invite" },
      expected: "/invites",
    },
    {
      name: "team_invite 即使带团队参数也指向 /invites",
      item: { type: "team_invite", teamSlug: "growth-squad" },
      expected: "/invites",
    },
    {
      name: "团队任务：拼接团队/项目 slug 与任务 id",
      item: {
        type: "task_assigned",
        taskId: "task-1",
        spaceType: "team",
        teamSlug: "growth-squad",
        projectSlug: "website-revamp",
      },
      expected: "/teams/growth-squad/projects/website-revamp/tasks/task-1",
    },
    {
      name: "团队任务缺 projectSlug → null",
      item: { type: "task_due_soon", taskId: "task-1", spaceType: "team", teamSlug: "growth-squad" },
      expected: null,
    },
    {
      name: "团队任务缺 teamSlug → null",
      item: { type: "task_overdue", taskId: "task-1", spaceType: "team", projectSlug: "website-revamp" },
      expected: null,
    },
    {
      name: "个人任务：指向 /my/tasks/{id}",
      item: { type: "task_commented", taskId: "task-2", spaceType: "personal" },
      expected: "/my/tasks/task-2",
    },
    {
      name: "个人任务缺 taskId → null",
      item: { type: "task_commented", spaceType: "personal" },
      expected: null,
    },
    {
      name: "task_changed_by_admin 团队任务",
      item: {
        type: "task_changed_by_admin",
        taskId: "task-3",
        spaceType: "team",
        teamSlug: "growth-squad",
        projectSlug: "website-revamp",
      },
      expected: "/teams/growth-squad/projects/website-revamp/tasks/task-3",
    },
    {
      name: "task_assigned 个人任务",
      item: { type: "task_assigned", taskId: "task-4", spaceType: "personal" },
      expected: "/my/tasks/task-4",
    },
    {
      name: "任务类通知缺 spaceType → null",
      item: { type: "task_overdue", taskId: "task-5" },
      expected: null,
    },
  ];

  for (const { name, item, expected } of cases) {
    it(name, () => {
      expect(buildNotificationHref(item)).toBe(expected);
    });
  }
});
