import { addDays } from "@open-doing/types";
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

import { getTeamOverview } from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[dashboard/team-overview/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const TODAY = "2026-10-24";
const BASE_TIME = new Date("2026-10-01T00:00:00Z").getTime();

async function createUser(db: DbClient, username: string) {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning({ id: users.id, username: users.username });
  return row!;
}

/**
 * 概览用例数据：
 * - 团队「增长突击队」：owner / admin / member 三人 + 一名非成员；
 * - 3 个项目：进度项目（2 个任务，等权平均 0.2/0.6）、风险项目（各状态任务 +
 *   1 个未指派逾期任务）、空项目（验证 0% 与无 NaN）；
 * - 另建一个外部团队，验证聚合不会跨团队串数据。
 */
async function seed(db: DbClient) {
  const owner = await createUser(db, "owner");
  const admin = await createUser(db, "admin");
  const member = await createUser(db, "member");
  const outsider = await createUser(db, "outsider");

  const [team] = await db
    .insert(teams)
    .values({
      name: "增长突击队",
      slug: "growth-squad",
      ownerId: owner.id,
      joinCode: generateJoinCode(),
    })
    .returning();
  await db.insert(teamMemberships).values([
    {
      teamId: team!.id,
      userId: owner.id,
      role: "owner",
      joinedAt: new Date(BASE_TIME),
    },
    {
      teamId: team!.id,
      userId: admin.id,
      role: "admin",
      joinedAt: new Date(BASE_TIME + 1000),
    },
    {
      teamId: team!.id,
      userId: member.id,
      role: "member",
      joinedAt: new Date(BASE_TIME + 2000),
    },
  ]);

  const projectRows = await db
    .insert(projects)
    .values([
      {
        teamId: team!.id,
        name: "进度项目",
        slug: "progress-project",
        createdAt: new Date(BASE_TIME + 1000),
      },
      {
        teamId: team!.id,
        name: "风险项目",
        slug: "risk-project",
        createdAt: new Date(BASE_TIME + 2000),
      },
      {
        teamId: team!.id,
        name: "空项目",
        slug: "empty-project",
        createdAt: new Date(BASE_TIME + 3000),
      },
    ])
    .returning({ id: projects.id, name: projects.name, slug: projects.slug });
  const [progressProject, riskProject, emptyProject] = projectRows;

  const taskRows = await db
    .insert(tasks)
    .values([
      // 进度项目：两个任务进度 1/5=0.2、3/5=0.6，项目进度应为 0.4。
      {
        spaceType: "team",
        projectId: progressProject!.id,
        title: "子任务两成",
        status: "in_progress",
        assigneeId: admin.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 1000),
      },
      {
        spaceType: "team",
        projectId: progressProject!.id,
        title: "子任务六成",
        status: "in_progress",
        assigneeId: admin.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 2000),
      },
      // 风险项目：逾期两笔（一笔早于另一笔）、临期两笔、进行中一笔、已完成一笔、未指派一笔。
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "成员逾期",
        status: "in_progress",
        dueDate: "2026-10-20",
        assigneeId: member.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 3000),
      },
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "管理员更早逾期",
        status: "todo",
        dueDate: "2026-10-18",
        assigneeId: admin.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 4000),
      },
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "成员临期明天",
        status: "todo",
        dueDate: "2026-10-25",
        assigneeId: member.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 5000),
      },
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "所有者今天到期",
        status: "in_progress",
        dueDate: "2026-10-24",
        assigneeId: owner.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 6000),
      },
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "成员进行中",
        status: "in_progress",
        assigneeId: member.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 7000),
      },
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "已完成逾期",
        status: "done",
        dueDate: "2026-10-19",
        assigneeId: member.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 8000),
      },
      {
        spaceType: "team",
        projectId: riskProject!.id,
        title: "未指派逾期",
        status: "todo",
        dueDate: "2026-10-22",
        assigneeId: null,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 9000),
      },
    ])
    .returning({ id: tasks.id, title: tasks.title });
  const idByTitle = new Map(taskRows.map((row) => [row.title, row.id]));

  // 进度项目两个任务的子任务：1/5 与 3/5。
  await db.insert(subtasks).values([
    ...[true, false, false, false, false].map((completed, index) => ({
      taskId: idByTitle.get("子任务两成")!,
      title: `两成子任务${index + 1}`,
      completed,
      completedAt: completed ? new Date(BASE_TIME + 10000 + index) : null,
    })),
    ...[true, true, true, false, false].map((completed, index) => ({
      taskId: idByTitle.get("子任务六成")!,
      title: `六成子任务${index + 1}`,
      completed,
      completedAt: completed ? new Date(BASE_TIME + 20000 + index) : null,
    })),
  ]);

  // 外部团队：同名成员也在其中负责逾期任务，用于验证按 teamId 隔离。
  const [otherTeam] = await db
    .insert(teams)
    .values({
      name: "外部团队",
      slug: "outside-team",
      ownerId: outsider.id,
      joinCode: generateJoinCode(),
    })
    .returning();
  await db.insert(teamMemberships).values({
    teamId: otherTeam!.id,
    userId: member.id,
    role: "member",
    joinedAt: new Date(BASE_TIME + 1000),
  });
  const [otherProject] = await db
    .insert(projects)
    .values({ teamId: otherTeam!.id, name: "外部项目", slug: "outside-project" })
    .returning();
  await db.insert(tasks).values({
    spaceType: "team",
    projectId: otherProject!.id,
    title: "外部团队逾期",
    status: "todo",
    dueDate: "2026-10-01",
    assigneeId: member.id,
    createdById: outsider.id,
  });

  return {
    team: team!,
    otherTeam: otherTeam!,
    owner,
    admin,
    member,
    outsider,
    progressProject: progressProject!,
    riskProject: riskProject!,
    emptyProject: emptyProject!,
    idByTitle,
  };
}

describe.skipIf(!hasTestDatabase)("团队概览聚合查询", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("项目健康度：进度为任务等权平均，空项目 0%，逾期/临期标记互不污染", async () => {
    const { team, progressProject, riskProject, emptyProject } = await seed(db);

    const { projects: healthList } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    // 项目按创建时间升序。
    expect(healthList.map((item) => item.projectName)).toEqual([
      "进度项目",
      "风险项目",
      "空项目",
    ]);

    const progressHealth = healthList.find(
      (item) => item.projectId === progressProject.id,
    )!;
    // (1/5 + 3/5) / 2 = 0.4。
    expect(progressHealth.progress).toBeCloseTo(0.4, 10);
    expect(progressHealth).toMatchObject({
      projectSlug: "progress-project",
      hasOverdue: false,
      hasDueSoon: false,
      taskCount: 2,
    });

    const riskHealth = healthList.find((item) => item.projectId === riskProject.id)!;
    expect(riskHealth.hasOverdue).toBe(true);
    expect(riskHealth.hasDueSoon).toBe(true);
    expect(riskHealth.taskCount).toBe(7);

    const emptyHealth = healthList.find((item) => item.projectId === emptyProject.id)!;
    expect(emptyHealth).toMatchObject({
      progress: 0,
      hasOverdue: false,
      hasDueSoon: false,
      taskCount: 0,
    });
    expect(Number.isNaN(emptyHealth.progress)).toBe(false);
  });

  it("团队统计：项目数 / 整体进度 / 临期 / 逾期，外部团队不参与聚合", async () => {
    const { team } = await seed(db);

    const { teamStats } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    // 9 个团队任务的进度和 = 0.2 + 0.6 + 0.5 + 0 + 0 + 0.5 + 0.5 + 1 + 0 = 3.3。
    expect(teamStats).toMatchObject({
      projectCount: 3,
      dueSoonCount: 2,
      overdueCount: 3,
    });
    expect(teamStats.avgProgress).toBeCloseTo(3.3 / 9, 10);
  });

  it("风险区：逾期在前、临期在后，各按 dueDate 升序；已完成不出现；未指派逾期也进风险区", async () => {
    const { team, idByTitle } = await seed(db);

    const { riskTasks } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    expect(riskTasks.map((item) => item.title)).toEqual([
      "管理员更早逾期",
      "成员逾期",
      "未指派逾期",
      "所有者今天到期",
      "成员临期明天",
    ]);
    expect(riskTasks.map((item) => item.kind)).toEqual([
      "overdue",
      "overdue",
      "overdue",
      "dueSoon",
      "dueSoon",
    ]);
    expect(riskTasks.map((item) => item.dueDate)).toEqual([
      "2026-10-18",
      "2026-10-20",
      "2026-10-22",
      "2026-10-24",
      "2026-10-25",
    ]);

    const unassignedRisk = riskTasks.find((item) => item.title === "未指派逾期")!;
    expect(unassignedRisk).toEqual({
      id: idByTitle.get("未指派逾期"),
      title: "未指派逾期",
      dueDate: "2026-10-22",
      kind: "overdue",
      assigneeName: null,
      projectName: "风险项目",
      href: `/space/growth-squad/projects/risk-project/tasks/${idByTitle.get("未指派逾期")}`,
    });

    expect(riskTasks.some((item) => item.title === "已完成逾期")).toBe(false);
    expect(riskTasks.some((item) => item.title === "外部团队逾期")).toBe(false);
  });

  it("成员负载：只统计本人任务，未指派任务不计入任何成员；未指派区独立成区", async () => {
    const { team, idByTitle } = await seed(db);

    const { members, unassigned } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    // 成员按加入时间升序；外部团队用户不出现。
    expect(members.map((item) => item.username)).toEqual(["owner", "admin", "member"]);

    const byName = new Map(members.map((item) => [item.username, item]));
    // 进行中 = 全部 status='in_progress'（「成员逾期」也在进行中），
    // 逾期 / 临期是与之叠加的时间维度，不是互斥分类。
    expect(byName.get("member")).toMatchObject({
      inProgress: 2,
      dueSoon: 1,
      overdue: 1,
    });
    // admin 还负责进度项目的两个子任务（均为进行中）。
    expect(byName.get("admin")).toMatchObject({
      inProgress: 2,
      dueSoon: 0,
      overdue: 1,
    });
    expect(byName.get("owner")).toMatchObject({
      inProgress: 1,
      dueSoon: 1,
      overdue: 0,
    });

    // 下钻任务只属于本人，且不包含未指派或其他成员的任务。
    const memberTasks = byName.get("member")!.tasks;
    expect(memberTasks.map((item) => item.title)).toEqual([
      "已完成逾期",
      "成员逾期",
      "成员临期明天",
      "成员进行中",
    ]);
    expect(memberTasks[0]).toMatchObject({
      id: idByTitle.get("已完成逾期"),
      status: "done",
      projectName: "风险项目",
      href: `/space/growth-squad/projects/risk-project/tasks/${idByTitle.get("已完成逾期")}`,
    });

    // 非本人任务不串：admin / owner 各自只看到自己的任务。
    expect(byName.get("admin")!.tasks.map((item) => item.title)).toEqual([
      "管理员更早逾期",
      "子任务两成",
      "子任务六成",
    ]);
    expect(byName.get("owner")!.tasks.map((item) => item.title)).toEqual([
      "所有者今天到期",
    ]);

    const allMemberTaskTitles = members.flatMap((item) =>
      item.tasks.map((task) => task.title),
    );
    // 未指派任务不出现在任何成员负载中；外部团队任务不参与本团队聚合。
    expect(allMemberTaskTitles).not.toContain("未指派逾期");
    expect(allMemberTaskTitles).not.toContain("外部团队逾期");

    expect(unassigned).toEqual([
      {
        id: idByTitle.get("未指派逾期"),
        title: "未指派逾期",
        dueDate: "2026-10-22",
        projectName: "风险项目",
        href: `/space/growth-squad/projects/risk-project/tasks/${idByTitle.get("未指派逾期")}`,
      },
    ]);
  });

  it("重要节点：未完成任务按截止日期升序，逾期 / 今天 / 明天 / 未来三态判定", async () => {
    const { team, riskProject, member, owner, idByTitle } = await seed(db);
    await db.insert(tasks).values({
      spaceType: "team",
      projectId: riskProject.id,
      title: "未来任务",
      status: "todo",
      dueDate: "2026-10-30",
      assigneeId: member.id,
      createdById: owner.id,
    });

    const { milestoneTasks } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    // 逾期（10-18 / 10-20 / 10-22）→ 今天（10-24）→ 明天（10-25）→ 未来（10-30）。
    expect(milestoneTasks.map((item) => item.title)).toEqual([
      "管理员更早逾期",
      "成员逾期",
      "未指派逾期",
      "所有者今天到期",
      "成员临期明天",
      "未来任务",
    ]);
    expect(milestoneTasks.map((item) => item.kind)).toEqual([
      "overdue",
      "overdue",
      "overdue",
      "dueSoon",
      "dueSoon",
      "upcoming",
    ]);
    expect(milestoneTasks.map((item) => item.dueDate)).toEqual([
      "2026-10-18",
      "2026-10-20",
      "2026-10-22",
      "2026-10-24",
      "2026-10-25",
      "2026-10-30",
    ]);

    // 未指派任务保留 null 责任人，行内链接指向任务详情。
    expect(milestoneTasks[2]).toEqual({
      id: idByTitle.get("未指派逾期"),
      title: "未指派逾期",
      dueDate: "2026-10-22",
      kind: "overdue",
      assigneeName: null,
      projectName: "风险项目",
      href: `/space/growth-squad/projects/risk-project/tasks/${idByTitle.get("未指派逾期")}`,
    });
  });

  it("重要节点：已完成、无截止日期与外部团队任务均不入列", async () => {
    const { team } = await seed(db);

    const { milestoneTasks } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    const titles = milestoneTasks.map((item) => item.title);
    expect(titles).not.toContain("已完成逾期");
    expect(titles).not.toContain("成员进行中");
    expect(titles).not.toContain("子任务两成");
    expect(titles).not.toContain("子任务六成");
    expect(titles).not.toContain("外部团队逾期");
  });

  it("重要节点：符合条件的任务超过 10 条时只取截止日期最早的 10 条", async () => {
    const { team, riskProject, member, owner } = await seed(db);
    // 10-26 起连续 12 天，加上种子里的 5 条合格任务，共 17 条待排序。
    await db.insert(tasks).values(
      Array.from({ length: 12 }, (_, index) => ({
        spaceType: "team" as const,
        projectId: riskProject.id,
        title: `补充任务 ${index + 1}`,
        status: "todo" as const,
        dueDate: addDays("2026-10-26", index),
        assigneeId: member.id,
        createdById: owner.id,
        createdAt: new Date(BASE_TIME + 30_000 + index),
      })),
    );

    const { milestoneTasks } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    expect(milestoneTasks).toHaveLength(10);
    expect(milestoneTasks.map((item) => item.dueDate)).toEqual([
      "2026-10-18",
      "2026-10-20",
      "2026-10-22",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
    ]);
    expect(milestoneTasks.at(-1)!.title).toBe("补充任务 5");
  });

  it("重要节点新增字段不影响风险区：未来任务只进重要节点", async () => {
    const { team, riskProject, member, owner } = await seed(db);
    await db.insert(tasks).values({
      spaceType: "team",
      projectId: riskProject.id,
      title: "未来任务",
      status: "todo",
      dueDate: "2026-10-30",
      assigneeId: member.id,
      createdById: owner.id,
    });

    const { riskTasks, milestoneTasks, teamStats } = await getTeamOverview(
      { teamId: team.id, teamSlug: team.slug, today: TODAY },
      db,
    );

    // 风险区仍只包含逾期 / 临期，统计卡口径不变。
    expect(riskTasks.map((item) => item.title)).toEqual([
      "管理员更早逾期",
      "成员逾期",
      "未指派逾期",
      "所有者今天到期",
      "成员临期明天",
    ]);
    expect(teamStats).toMatchObject({ dueSoonCount: 2, overdueCount: 3 });
    expect(milestoneTasks.map((item) => item.title)).toContain("未来任务");
  });

  it("空团队：无项目、无任务时统计全为 0，成员负载为空", async () => {
    const owner = await createUser(db, "empty-owner");
    const [team] = await db
      .insert(teams)
      .values({
        name: "空团队",
        slug: "empty-team",
        ownerId: owner.id,
        joinCode: generateJoinCode(),
      })
      .returning();
    await db
      .insert(teamMemberships)
      .values({ teamId: team!.id, userId: owner.id, role: "owner" });

    const overview = await getTeamOverview(
      { teamId: team!.id, teamSlug: team!.slug, today: TODAY },
      db,
    );

    expect(overview.projects).toEqual([]);
    expect(overview.riskTasks).toEqual([]);
    expect(overview.milestoneTasks).toEqual([]);
    expect(overview.unassigned).toEqual([]);
    expect(overview.teamStats).toEqual({
      projectCount: 0,
      avgProgress: 0,
      dueSoonCount: 0,
      overdueCount: 0,
    });
    expect(overview.members).toHaveLength(1);
    expect(overview.members[0]).toMatchObject({
      username: "empty-owner",
      inProgress: 0,
      dueSoon: 0,
      overdue: 0,
      tasks: [],
    });
  });
});
