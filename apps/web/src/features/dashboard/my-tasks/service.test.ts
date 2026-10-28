import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  projects,
  subtasks,
  tasks,
  teamMemberships,
  teams,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { addDays } from "@open-doing/types";

import {
  getMyTaskStats,
  getTodayBoard,
  getWeekStart,
  listCrossSpaceProjects,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[dashboard/my-tasks/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const TODAY = "2026-10-24";
const WEEK_START = "2026-10-19";
const BASE_TIME = new Date("2026-10-01T00:00:00Z").getTime();

async function createUser(db: DbClient, username: string) {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning({ id: users.id, username: users.username });
  return row!;
}

/** 造一队：团队 + 项目；member 可选加入成员关系。 */
async function createTeam(
  db: DbClient,
  input: { ownerId: string; name: string; slug: string; memberIds?: string[] },
) {
  const [team] = await db
    .insert(teams)
    .values({
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      joinCode: generateJoinCode(),
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ teamId: team!.id, name: `${input.name}项目`, slug: `${input.slug}-project` })
    .returning();

  if (input.memberIds?.length) {
    await db.insert(teamMemberships).values(
      input.memberIds.map((userId) => ({ teamId: team!.id, userId, role: "member" as const })),
    );
  }

  return { team: team!, project: project! };
}

/** 统计用例数据：覆盖进行中 / 临期 / 逾期 / 本周完成及各类排除项。 */
async function seedStats(db: DbClient) {
  const member = await createUser(db, "member");
  const other = await createUser(db, "other");
  const { project: teamProject } = await createTeam(db, {
    ownerId: other.id,
    name: "增长突击队",
    slug: "growth-squad",
    memberIds: [member.id],
  });

  await db.insert(tasks).values([
    // 计入进行中（无截止日期，不干扰临期/逾期）。
    { spaceType: "personal", title: "进行中", status: "in_progress", assigneeId: member.id, createdById: member.id },
    // 计入临期：今天 / 明天各一。
    { spaceType: "personal", title: "今天到期", dueDate: TODAY, assigneeId: member.id, createdById: member.id },
    { spaceType: "personal", title: "明天到期", dueDate: "2026-10-25", assigneeId: member.id, createdById: member.id },
    // 计入逾期。
    { spaceType: "personal", title: "已逾期", dueDate: "2026-10-23", assigneeId: member.id, createdById: member.id },
    // 已完成任务：即使今天到期也不计入临期；updatedAt 早于本周不计入本周完成。
    {
      spaceType: "personal",
      title: "已完成旧任务",
      status: "done",
      dueDate: TODAY,
      assigneeId: member.id,
      createdById: member.id,
      updatedAt: new Date("2026-10-10T00:00:00Z"),
    },
    // 计入本周完成。
    {
      spaceType: "personal",
      title: "本周完成",
      status: "done",
      assigneeId: member.id,
      createdById: member.id,
      updatedAt: new Date("2026-10-20T00:00:00Z"),
    },
    // 边界：上海时区周一 03:00（UTC 尚是周日）→ 应计入本周完成。
    {
      spaceType: "personal",
      title: "上海周一凌晨完成",
      status: "done",
      assigneeId: member.id,
      createdById: member.id,
      updatedAt: new Date("2026-10-18T19:00:00Z"),
    },
    // 边界：上海时区周日 23:30 → 不应计入本周完成。
    {
      spaceType: "personal",
      title: "上海周日深夜完成",
      status: "done",
      assigneeId: member.id,
      createdById: member.id,
      updatedAt: new Date("2026-10-18T15:30:00Z"),
    },
    // 团队任务：本人已指派（无截止日期，不改变三项日期计数）。
    { spaceType: "team", projectId: teamProject.id, title: "我的团队任务", assigneeId: member.id, createdById: other.id },
    // 团队进行中：用于断言按空间拆分的进行中数量。
    {
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队进行中",
      status: "in_progress",
      assigneeId: member.id,
      createdById: other.id,
    },
    // 排除：未指派团队任务。
    { spaceType: "team", projectId: teamProject.id, title: "未指派团队任务", assigneeId: null, createdById: other.id },
    // 排除：他人任务。
    { spaceType: "personal", title: "他人进行中", status: "in_progress", assigneeId: other.id, createdById: other.id },
    { spaceType: "personal", title: "他人今天到期", dueDate: TODAY, assigneeId: other.id, createdById: other.id },
    { spaceType: "personal", title: "他人已逾期", dueDate: "2026-10-01", assigneeId: other.id, createdById: other.id },
  ]);

  return { member, other };
}

/** 列表用例数据：个人 / 团队 / 跨空间项目与子任务计数。 */
async function seedLists(db: DbClient) {
  const member = await createUser(db, "member");
  const other = await createUser(db, "other");

  const [personalProject] = await db
    .insert(projects)
    .values({ ownerId: member.id, name: "读书笔记", slug: "reading-notes" })
    .returning();
  const [otherPersonalProject] = await db
    .insert(projects)
    .values({ ownerId: other.id, name: "别人的个人项目", slug: "secret-notes" })
    .returning();

  const { team, project: teamProject } = await createTeam(db, {
    ownerId: other.id,
    name: "增长突击队",
    slug: "growth-squad",
    memberIds: [member.id],
  });
  // member 不在这个团队，其项目不应出现在跨空间项目列表中。
  const { project: foreignTeamProject } = await createTeam(db, {
    ownerId: other.id,
    name: "外部团队",
    slug: "outside-team",
  });

  const inserted = await db
    .insert(tasks)
    .values([
      // 个人：有日期在前升序，无日期最后；同日按 createdAt 降序。
      {
        spaceType: "personal",
        title: "零散任务A",
        dueDate: "2026-10-25",
        assigneeId: member.id,
        createdById: member.id,
        createdAt: new Date(BASE_TIME + 1000),
      },
      {
        spaceType: "personal",
        projectId: personalProject!.id,
        title: "项目任务B",
        assigneeId: member.id,
        createdById: member.id,
        createdAt: new Date(BASE_TIME + 5000),
      },
      {
        spaceType: "personal",
        projectId: personalProject!.id,
        title: "项目任务C",
        dueDate: "2026-10-20",
        assigneeId: member.id,
        createdById: member.id,
        createdAt: new Date(BASE_TIME + 2000),
      },
      {
        spaceType: "personal",
        title: "零散任务D",
        dueDate: "2026-10-20",
        assigneeId: member.id,
        createdById: member.id,
        createdAt: new Date(BASE_TIME + 3000),
      },
      // 他人个人任务：不出现在本人列表。
      {
        spaceType: "personal",
        projectId: otherPersonalProject!.id,
        title: "他人的任务",
        dueDate: "2026-10-01",
        assigneeId: other.id,
        createdById: other.id,
      },
      // 团队任务：跨全部团队按 assignee 查询。
      {
        spaceType: "team",
        projectId: teamProject.id,
        title: "团队任务一",
        dueDate: "2026-10-21",
        assigneeId: member.id,
        createdById: other.id,
        createdAt: new Date(BASE_TIME + 1000),
      },
      {
        spaceType: "team",
        projectId: teamProject.id,
        title: "团队任务二",
        assigneeId: member.id,
        createdById: other.id,
        createdAt: new Date(BASE_TIME + 4000),
      },
      {
        spaceType: "team",
        projectId: foreignTeamProject.id,
        title: "外部团队任务",
        dueDate: "2026-10-19",
        assigneeId: member.id,
        createdById: other.id,
      },
      // 排除项：未指派 / 指派给他人。
      {
        spaceType: "team",
        projectId: teamProject.id,
        title: "未指派团队任务",
        dueDate: "2026-10-01",
        assigneeId: null,
        createdById: other.id,
      },
      {
        spaceType: "team",
        projectId: teamProject.id,
        title: "他人的团队任务",
        dueDate: "2026-10-01",
        assigneeId: other.id,
        createdById: other.id,
      },
    ])
    .returning({ id: tasks.id, title: tasks.title });

  const idByTitle = new Map(inserted.map((row) => [row.title, row.id]));
  const projectTaskId = idByTitle.get("项目任务B")!;

  // 5 个子任务，3 个已完成 → 3/5。
  await db.insert(subtasks).values(
    [true, true, true, false, false].map((completed, index) => ({
      taskId: projectTaskId,
      title: `子任务${index + 1}`,
      completed,
      completedAt: completed ? new Date(BASE_TIME + 10000 + index) : null,
    })),
  );

  return {
    member,
    other,
    personalProject: personalProject!,
    otherPersonalProject: otherPersonalProject!,
    team: team!,
    teamProject: teamProject!,
    foreignTeamProject: foreignTeamProject!,
    idByTitle,
  };
}

describe("getWeekStart", () => {
  it("周六回退到本周一", () => {
    expect(getWeekStart("2026-10-24")).toBe("2026-10-19");
  });

  it("周一返回自身", () => {
    expect(getWeekStart("2026-10-19")).toBe("2026-10-19");
  });

  it("周日仍返回本周一（跨月）", () => {
    expect(getWeekStart("2026-11-01")).toBe("2026-10-26");
  });
});

describe.skipIf(!hasTestDatabase)("我的任务聚合查询", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("getMyTaskStats 按本人指派统计四项，已完成 / 他人 / 未指派不计", async () => {
    const { member } = await seedStats(db);

    const stats = await getMyTaskStats({ userId: member.id, today: TODAY, weekStart: WEEK_START }, db);

    // doneThisWeek = 2：「本周完成」+ 上海周一 03:00 完成；
    // 上海周日 23:30 完成的任务不得跨周计入。
    expect(stats).toEqual({
      inProgress: 2,
      inProgressPersonal: 1,
      inProgressTeam: 1,
      dueSoon: 2,
      overdue: 1,
      doneThisWeek: 2,
    });
  });

  it("getMyTaskStats 无任务时四项均为 0", async () => {
    const nobody = await createUser(db, "nobody");

    const stats = await getMyTaskStats({ userId: nobody.id, today: TODAY, weekStart: WEEK_START }, db);

    expect(stats).toEqual({
      inProgress: 0,
      inProgressPersonal: 0,
      inProgressTeam: 0,
      dueSoon: 0,
      overdue: 0,
      doneThisWeek: 0,
    });
  });

  it("getTodayBoard：只含未完成且截止 ≤ 今天的任务（个人 + 团队），明天 / 已完成 / 他人 / 无日期排除", async () => {
    const member = await createUser(db, "member");
    const other = await createUser(db, "other");
    const { team, project } = await createTeam(db, {
      ownerId: other.id,
      name: "增长突击队",
      slug: "growth-squad",
      memberIds: [member.id],
    });

    await db.insert(tasks).values([
      {
        spaceType: "personal",
        title: "个人今天",
        dueDate: TODAY,
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "team",
        projectId: project.id,
        title: "团队今天",
        dueDate: TODAY,
        assigneeId: member.id,
        createdById: other.id,
      },
      {
        spaceType: "personal",
        title: "个人昨天",
        dueDate: addDays(TODAY, -1),
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        title: "明天到期",
        dueDate: addDays(TODAY, 1),
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        title: "已完成今天",
        status: "done",
        dueDate: TODAY,
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        title: "他人今天",
        dueDate: TODAY,
        assigneeId: other.id,
        createdById: other.id,
      },
      {
        spaceType: "personal",
        title: "无截止日期",
        assigneeId: member.id,
        createdById: member.id,
      },
    ]);

    const board = await getTodayBoard({ userId: member.id, today: TODAY }, db);

    expect(board.tasks.map((task) => task.title).sort()).toEqual([
      "个人今天",
      "个人昨天",
      "团队今天",
    ].sort());
    expect(board.total).toBe(3);

    // teamId：个人任务为 null，团队任务带所属团队（勾选完成走 updateTeamTaskAction）。
    expect(board.tasks.find((task) => task.title === "个人今天")).toMatchObject({
      teamId: null,
      projectName: null,
      spaceType: "personal",
    });
    expect(board.tasks.find((task) => task.title === "团队今天")).toMatchObject({
      teamId: team.id,
      projectName: "增长突击队项目",
      spaceType: "team",
    });
  });

  it("getTodayBoard：按截止日期升序，逾期在前，今天最后", async () => {
    const member = await createUser(db, "member");

    await db.insert(tasks).values([
      { spaceType: "personal", title: "今天", dueDate: TODAY, assigneeId: member.id, createdById: member.id },
      { spaceType: "personal", title: "较早逾期", dueDate: "2026-10-01", assigneeId: member.id, createdById: member.id },
      { spaceType: "personal", title: "较晚逾期", dueDate: "2026-10-03", assigneeId: member.id, createdById: member.id },
    ]);

    const board = await getTodayBoard({ userId: member.id, today: TODAY }, db);

    expect(board.tasks.map((task) => task.dueDate)).toEqual([
      "2026-10-01",
      "2026-10-03",
      TODAY,
    ]);
  });

  it("getTodayBoard：limit 默认封顶 20，total 为同条件全量", async () => {
    const member = await createUser(db, "member");

    await db.insert(tasks).values(
      Array.from({ length: 25 }, (_, index) => ({
        spaceType: "personal" as const,
        title: `今日任务${index + 1}`,
        dueDate: TODAY,
        assigneeId: member.id,
        createdById: member.id,
      })),
    );

    const board = await getTodayBoard({ userId: member.id, today: TODAY }, db);

    expect(board.tasks).toHaveLength(20);
    expect(board.total).toBe(25);
  });

  it("getTodayBoard：支持自定义 limit", async () => {
    const member = await createUser(db, "member");

    await db.insert(tasks).values(
      Array.from({ length: 5 }, (_, index) => ({
        spaceType: "personal" as const,
        title: `今日任务${index + 1}`,
        dueDate: TODAY,
        assigneeId: member.id,
        createdById: member.id,
      })),
    );

    const board = await getTodayBoard({ userId: member.id, today: TODAY, limit: 2 }, db);

    expect(board.tasks).toHaveLength(2);
    expect(board.total).toBe(5);
  });

  it("listCrossSpaceProjects：个人项目在前，团队项目带团队名，他人 / 非成员团队项目不出现", async () => {
    const { member, personalProject, teamProject, otherPersonalProject, foreignTeamProject } =
      await seedLists(db);

    const options = await listCrossSpaceProjects(member.id, db);

    expect(options[0]).toEqual({
      projectId: personalProject.id,
      projectName: "读书笔记",
      projectSlug: "reading-notes",
      teamId: null,
      teamName: null,
    });
    expect(options).toContainEqual({
      projectId: teamProject.id,
      projectName: "增长突击队项目",
      projectSlug: "growth-squad-project",
      teamId: teamProject.teamId,
      teamName: "增长突击队",
    });

    const ids = options.map((option) => option.projectId);
    expect(ids).not.toContain(otherPersonalProject.id);
    expect(ids).not.toContain(foreignTeamProject.id);
    expect(ids).toHaveLength(2);
  });
});
