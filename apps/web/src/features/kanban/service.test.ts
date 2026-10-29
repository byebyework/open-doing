import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  projects,
  subtasks,
  tasks,
  teams,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  getOlderDonePersonalTasks,
  getOlderDoneTeamTasks,
  getPersonalSpaceBoard,
  getTeamSpaceBoard,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[kanban/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const TODAY = "2026-10-21";
/** 近 7 天窗口起点：today - 6 = 2026-10-15（上海日历日零点）。 */
const RECENT_START = new Date("2026-10-15T00:00:00+08:00");
/** 窗口外边界：today - 7 = 2026-10-14（上海日历日零点）。 */
const OLDER_START = new Date("2026-10-14T00:00:00+08:00");

async function createUser(db: DbClient, username: string) {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning({ id: users.id, username: users.username });
  return row!;
}

async function createPersonalProject(
  db: DbClient,
  input: { ownerId: string; name: string; slug: string },
) {
  const [row] = await db
    .insert(projects)
    .values({ ownerId: input.ownerId, name: input.name, slug: input.slug })
    .returning();
  return row!;
}

/**
 * 两个个人项目 + 覆盖三列与 7 天窗口两侧的任务。
 *
 * - todo：逾期两条 / 今天 / 未来 / 无截止 / 零散个人任务（projectId 为空）/
 *   窗口内已完成（不应出现）
 * - in_progress：一条
 * - done：窗口内两条（含下边界 today-6）、窗口外两条（含 today-7）
 * - 排除项：他人个人任务、团队任务
 */
async function seedBoard(db: DbClient) {
  const member = await createUser(db, "member");
  const other = await createUser(db, "other");

  const study = await createPersonalProject(db, {
    ownerId: member.id,
    name: "学习成长",
    slug: "study",
  });
  const life = await createPersonalProject(db, {
    ownerId: member.id,
    name: "生活琐事",
    slug: "life",
  });

  const [team] = await db
    .insert(teams)
    .values({
      name: "增长突击队",
      slug: "growth-squad",
      ownerId: other.id,
      joinCode: generateJoinCode(),
    })
    .returning();
  const [teamProject] = await db
    .insert(projects)
    .values({ teamId: team!.id, name: "增长突击队项目", slug: "growth-project" })
    .returning();

  const inserted = await db
    .insert(tasks)
    .values([
      // ---- todo：排序覆盖逾期（两条升序）→ 今天 → 未来 → 无截止 ----
      {
        spaceType: "personal",
        projectId: study.id,
        title: "逾期较早",
        status: "todo",
        dueDate: "2026-10-01",
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        projectId: life.id,
        title: "逾期较晚",
        status: "todo",
        dueDate: "2026-10-03",
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        projectId: study.id,
        title: "今天到期",
        status: "todo",
        dueDate: TODAY,
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        projectId: life.id,
        title: "未来到期",
        status: "todo",
        dueDate: "2026-10-25",
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        spaceType: "personal",
        projectId: study.id,
        title: "无截止",
        status: "todo",
        dueDate: null,
        assigneeId: member.id,
        createdById: member.id,
      },
      {
        // 零散个人任务（不属于任何项目）。显式 createdAt 使其与「无截止」
        // （默认 now）在 nulls last 组内按 createdAt desc 稳定排序。
        spaceType: "personal",
        projectId: null,
        title: "零散任务",
        status: "todo",
        dueDate: null,
        assigneeId: member.id,
        createdById: member.id,
        createdAt: new Date("2026-10-10T10:00:00+08:00"),
      },
      // ---- in_progress ----
      {
        spaceType: "personal",
        projectId: life.id,
        title: "进行中任务",
        status: "in_progress",
        dueDate: "2026-10-22",
        assigneeId: member.id,
        createdById: member.id,
      },
      // ---- done：窗口内（含下边界 today-6） ----
      {
        spaceType: "personal",
        projectId: study.id,
        title: "窗口下边界完成",
        status: "done",
        assigneeId: member.id,
        createdById: member.id,
        updatedAt: RECENT_START,
      },
      {
        spaceType: "personal",
        projectId: life.id,
        title: "窗口内较新完成",
        status: "done",
        assigneeId: member.id,
        createdById: member.id,
        updatedAt: new Date("2026-10-19T09:30:00+08:00"),
      },
      // ---- done：窗口外（含上边界 today-7） ----
      {
        spaceType: "personal",
        projectId: study.id,
        title: "窗口上边界完成",
        status: "done",
        assigneeId: member.id,
        createdById: member.id,
        updatedAt: OLDER_START,
      },
      {
        spaceType: "personal",
        projectId: life.id,
        title: "很久以前完成",
        status: "done",
        assigneeId: member.id,
        createdById: member.id,
        updatedAt: new Date("2026-09-01T12:00:00+08:00"),
      },
      // ---- 排除项 ----
      {
        spaceType: "personal",
        projectId: study.id,
        title: "他人的个人任务",
        status: "todo",
        dueDate: "2026-10-01",
        assigneeId: other.id,
        createdById: other.id,
      },
      {
        spaceType: "team",
        projectId: teamProject!.id,
        title: "团队任务",
        status: "todo",
        dueDate: "2026-10-01",
        assigneeId: member.id,
        createdById: other.id,
      },
    ])
    .returning({ id: tasks.id, title: tasks.title });

  const idByTitle = new Map(inserted.map((row) => [row.title, row.id]));

  // 「今天到期」2/5 子任务完成（卡片计数断言）。
  const todayTaskId = idByTitle.get("今天到期")!;
  await db.insert(subtasks).values(
    [true, true, false, false, false].map((completed, index) => ({
      taskId: todayTaskId,
      title: `子任务${index + 1}`,
      completed,
      completedAt: completed ? new Date("2026-10-20T00:00:00Z") : null,
    })),
  );

  return { member, other, study, life, idByTitle };
}

describe.skipIf(!hasTestDatabase)("个人空间看板聚合", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("todo / in_progress 按截止升序：逾期 → 今天 → 未来 → 无截止（含零散任务垫底），两个逾期按截止升序", async () => {
    const { member } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);

    expect(board.todo.map((card) => card.title)).toEqual([
      "逾期较早",
      "逾期较晚",
      "今天到期",
      "未来到期",
      "无截止",
      "零散任务",
    ]);
    expect(board.todo.map((card) => card.dueDate)).toEqual([
      "2026-10-01",
      "2026-10-03",
      TODAY,
      "2026-10-25",
      null,
      null,
    ]);
    expect(board.inProgress.map((card) => card.title)).toEqual(["进行中任务"]);
  });

  it("done 窗口边界：today-6 属于 doneRecent，today-7 只计入 doneOlderCount", async () => {
    const { member } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);

    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口内较新完成",
      "窗口下边界完成",
    ]);
    expect(board.doneRecent.map((card) => card.title)).not.toContain("窗口上边界完成");
    expect(board.doneRecent.map((card) => card.title)).not.toContain("很久以前完成");
    // 窗口外的两条（today-7 边界 + 更早）只计入 doneOlderCount。
    expect(board.doneOlderCount).toBe(2);
    expect(board.doneRecent).toHaveLength(2);
  });

  it("doneRecent 按 updatedAt 降序，completedAt 等于 updatedAt", async () => {
    const { member } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);

    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口内较新完成",
      "窗口下边界完成",
    ]);
    expect(board.doneRecent[0]!.completedAt).toBe(
      new Date("2026-10-19T09:30:00+08:00").toISOString(),
    );
    expect(board.doneRecent[1]!.completedAt).toBe(RECENT_START.toISOString());
  });

  it("doneOlderCount / doneTotal 覆盖 7 天窗口两侧", async () => {
    const { member } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);

    // 已完成共 4 条：窗口内 2、窗口外 2。
    expect(board.doneOlderCount).toBe(2);
    expect(board.doneTotal).toBe(4);
  });

  it("窗口内已完成的 done 任务不进入 todo / in_progress", async () => {
    const { member } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);
    const activeTitles = [...board.todo, ...board.inProgress].map((card) => card.title);

    expect(activeTitles).not.toContain("窗口内较新完成");
    expect(activeTitles).not.toContain("窗口下边界完成");
  });

  it("卡片带 projectId / projectName 与子任务计数（2/5）", async () => {
    const { member, study } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);
    const todayCard = board.todo.find((card) => card.title === "今天到期")!;

    expect(todayCard).toMatchObject({
      projectId: study.id,
      projectName: "学习成长",
      subtaskTotal: 5,
      subtaskDone: 2,
      status: "todo",
      completedAt: null,
    });
    // 跨项目聚合：另一个项目的卡片带各自项目名。
    expect(board.todo.find((card) => card.title === "未来到期")).toMatchObject({
      projectName: "生活琐事",
    });
    // 零散个人任务（projectId 为空）：项目字段映射为空字符串，仍进入 todo 列。
    expect(board.todo.find((card) => card.title === "零散任务")).toMatchObject({
      projectId: "",
      projectName: "",
      status: "todo",
    });
  });

  it("只聚合本人的个人任务：他人个人任务与团队任务不出现", async () => {
    const { member } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db);
    const titles = [
      ...board.todo,
      ...board.inProgress,
      ...board.doneRecent,
    ].map((card) => card.title);

    expect(titles).not.toContain("他人的个人任务");
    expect(titles).not.toContain("团队任务");
    // 本人的个人任务全部纳入（含跨项目与零散任务）。
    expect(board.todo).toHaveLength(6);
  });

  it("getOlderDonePersonalTasks 返回窗口外全部已完成，排序同 done 列（updatedAt 降序）", async () => {
    const { member } = await seedBoard(db);

    const older = await getOlderDonePersonalTasks(member.id, TODAY, db);

    expect(older.map((card) => card.title)).toEqual([
      "窗口上边界完成",
      "很久以前完成",
    ]);
    expect(older[0]!.completedAt).toBe(OLDER_START.toISOString());
    expect(older[0]!.projectName).toBe("学习成长");
    expect(older[0]!.status).toBe("done");
  });
});

async function createTeam(
  db: DbClient,
  input: { ownerId: string; name: string; slug: string },
) {
  const [row] = await db
    .insert(teams)
    .values({
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      joinCode: generateJoinCode(),
    })
    .returning();
  return row!;
}

async function createTeamProject(
  db: DbClient,
  input: { teamId: string; name: string; slug: string },
) {
  const [row] = await db
    .insert(projects)
    .values({ teamId: input.teamId, name: input.name, slug: input.slug })
    .returning();
  return row!;
}

/**
 * 团队 A（两个项目）+ 团队 B（一个项目）+ 一个个人项目，覆盖三列、7 天窗口两侧、
 * 未指派、成员退出后置空、以及团队/空间隔离。
 *
 * - todo：逾期两条 / 成员退出（assignee 置空）/ 今天 / 未来 / 无截止 / 未指派
 * - in_progress：一条
 * - done：窗口内两条（含下边界 today-6）、窗口外两条（含 today-7，其一未指派）
 * - 排除项：团队 B 任务、个人空间任务
 *
 * 团队任务在 schema 上必须归属某个团队项目（FK），因此不存在零散团队任务。
 */
async function seedTeamBoard(db: DbClient) {
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  const removed = await createUser(db, "removed-member");

  const teamA = await createTeam(db, {
    ownerId: alice.id,
    name: "增长突击队",
    slug: "growth-squad",
  });
  const teamB = await createTeam(db, {
    ownerId: bob.id,
    name: "稳定小队",
    slug: "defense-squad",
  });

  const growth = await createTeamProject(db, {
    teamId: teamA.id,
    name: "增长项目",
    slug: "growth",
  });
  const retention = await createTeamProject(db, {
    teamId: teamA.id,
    name: "留存项目",
    slug: "retention",
  });
  const defense = await createTeamProject(db, {
    teamId: teamB.id,
    name: "外部项目",
    slug: "defense",
  });
  const personalProject = await createPersonalProject(db, {
    ownerId: alice.id,
    name: "个人项目",
    slug: "personal-project",
  });

  const inserted = await db
    .insert(tasks)
    .values([
      // ---- todo：排序覆盖逾期（两条升序）→ 今天 → 未来 → 无截止 / 未指派 ----
      {
        spaceType: "team",
        projectId: growth.id,
        title: "逾期较早",
        status: "todo",
        dueDate: "2026-10-01",
        assigneeId: alice.id,
        createdById: alice.id,
      },
      {
        // 模拟成员被移除：先指派给 removed-member，插入后将其 assignee_id 置空。
        spaceType: "team",
        projectId: retention.id,
        title: "成员退出任务",
        status: "todo",
        dueDate: "2026-10-02",
        assigneeId: removed.id,
        createdById: alice.id,
      },
      {
        spaceType: "team",
        projectId: growth.id,
        title: "逾期较晚",
        status: "todo",
        dueDate: "2026-10-03",
        assigneeId: bob.id,
        createdById: alice.id,
      },
      {
        spaceType: "team",
        projectId: growth.id,
        title: "今天到期",
        status: "todo",
        dueDate: TODAY,
        assigneeId: alice.id,
        createdById: alice.id,
      },
      {
        spaceType: "team",
        projectId: retention.id,
        title: "未来到期",
        status: "todo",
        dueDate: "2026-10-25",
        assigneeId: bob.id,
        createdById: alice.id,
      },
      {
        spaceType: "team",
        projectId: growth.id,
        title: "无截止",
        status: "todo",
        dueDate: null,
        assigneeId: alice.id,
        createdById: alice.id,
      },
      {
        // 未指派任务；显式 createdAt 使其与「无截止」（默认 now）在 nulls last
        // 组内按 createdAt desc 稳定排序。
        spaceType: "team",
        projectId: retention.id,
        title: "未指派任务",
        status: "todo",
        dueDate: null,
        assigneeId: null,
        createdById: alice.id,
        createdAt: new Date("2026-10-10T10:00:00+08:00"),
      },
      // ---- in_progress ----
      {
        spaceType: "team",
        projectId: growth.id,
        title: "进行中任务",
        status: "in_progress",
        dueDate: "2026-10-22",
        assigneeId: alice.id,
        createdById: alice.id,
      },
      // ---- done：窗口内（含下边界 today-6） ----
      {
        spaceType: "team",
        projectId: growth.id,
        title: "窗口下边界完成",
        status: "done",
        assigneeId: alice.id,
        createdById: alice.id,
        updatedAt: RECENT_START,
      },
      {
        spaceType: "team",
        projectId: retention.id,
        title: "窗口内较新完成",
        status: "done",
        assigneeId: bob.id,
        createdById: alice.id,
        updatedAt: new Date("2026-10-19T09:30:00+08:00"),
      },
      // ---- done：窗口外（含上边界 today-7） ----
      {
        spaceType: "team",
        projectId: growth.id,
        title: "窗口上边界完成",
        status: "done",
        assigneeId: alice.id,
        createdById: alice.id,
        updatedAt: OLDER_START,
      },
      {
        spaceType: "team",
        projectId: retention.id,
        title: "很久以前完成",
        status: "done",
        assigneeId: null,
        createdById: alice.id,
        updatedAt: new Date("2026-09-01T12:00:00+08:00"),
      },
      // ---- 排除项：团队 B / 个人空间 ----
      {
        spaceType: "team",
        projectId: defense.id,
        title: "团队B任务",
        status: "todo",
        dueDate: "2026-10-01",
        assigneeId: alice.id,
        createdById: bob.id,
      },
      {
        spaceType: "personal",
        projectId: personalProject.id,
        title: "个人任务",
        status: "todo",
        dueDate: "2026-10-01",
        assigneeId: alice.id,
        createdById: alice.id,
      },
    ])
    .returning({ id: tasks.id, title: tasks.title });

  const idByTitle = new Map(inserted.map((row) => [row.title, row.id]));

  // 成员被移除：membership 删除，任务 assignee_id 置空（任务本身保留）。
  await db
    .update(tasks)
    .set({ assigneeId: null })
    .where(eq(tasks.id, idByTitle.get("成员退出任务")!));

  // 「今天到期」2/5 子任务完成（卡片计数断言）。
  await db.insert(subtasks).values(
    [true, true, false, false, false].map((completed, index) => ({
      taskId: idByTitle.get("今天到期")!,
      title: `子任务${index + 1}`,
      completed,
      completedAt: completed ? new Date("2026-10-20T00:00:00Z") : null,
    })),
  );

  return {
    alice,
    bob,
    removed,
    teamA,
    teamB,
    growth,
    retention,
    defense,
    idByTitle,
  };
}

describe.skipIf(!hasTestDatabase)("团队空间看板聚合", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("todo / in_progress 按截止升序：逾期 → 今天 → 未来 → 无截止（含未指派垫底），两个逾期按截止升序", async () => {
    const { teamA } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);

    expect(board.todo.map((card) => card.title)).toEqual([
      "逾期较早",
      "成员退出任务",
      "逾期较晚",
      "今天到期",
      "未来到期",
      "无截止",
      "未指派任务",
    ]);
    expect(board.todo.map((card) => card.dueDate)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      TODAY,
      "2026-10-25",
      null,
      null,
    ]);
    expect(board.inProgress.map((card) => card.title)).toEqual(["进行中任务"]);
  });

  it("assigneeName 来自 users join；未指派任务 assigneeId / assigneeName 均为 null", async () => {
    const { teamA, alice, bob } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);
    const byTitle = new Map(board.todo.map((card) => [card.title, card]));

    expect(byTitle.get("逾期较早")).toMatchObject({
      assigneeId: alice.id,
      assigneeName: "alice",
    });
    expect(byTitle.get("逾期较晚")).toMatchObject({
      assigneeId: bob.id,
      assigneeName: "bob",
    });
    expect(byTitle.get("未指派任务")).toMatchObject({
      assigneeId: null,
      assigneeName: null,
    });
  });

  it("成员被移除（assignee_id 置空）的任务正常显示为未指派，不丢卡", async () => {
    const { teamA } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);
    const removedCard = board.todo.find((card) => card.title === "成员退出任务");

    expect(removedCard).toMatchObject({
      assigneeId: null,
      assigneeName: null,
      status: "todo",
      dueDate: "2026-10-02",
      projectName: "留存项目",
    });
  });

  it("done 窗口边界：today-6 属于 doneRecent，today-7 只计入 doneOlderCount", async () => {
    const { teamA } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);

    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口内较新完成",
      "窗口下边界完成",
    ]);
    expect(board.doneRecent.map((card) => card.title)).not.toContain("窗口上边界完成");
    expect(board.doneRecent.map((card) => card.title)).not.toContain("很久以前完成");
    expect(board.doneOlderCount).toBe(2);
    expect(board.doneRecent).toHaveLength(2);
  });

  it("doneRecent 按 updatedAt 降序，completedAt 等于 updatedAt，带 assignee 信息", async () => {
    const { teamA, alice, bob } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);

    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口内较新完成",
      "窗口下边界完成",
    ]);
    expect(board.doneRecent[0]).toMatchObject({
      completedAt: new Date("2026-10-19T09:30:00+08:00").toISOString(),
      assigneeId: bob.id,
      assigneeName: "bob",
    });
    expect(board.doneRecent[1]).toMatchObject({
      completedAt: RECENT_START.toISOString(),
      assigneeId: alice.id,
      assigneeName: "alice",
    });
  });

  it("doneOlderCount / doneTotal 覆盖 7 天窗口两侧", async () => {
    const { teamA } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);

    // 已完成共 4 条：窗口内 2、窗口外 2。
    expect(board.doneOlderCount).toBe(2);
    expect(board.doneTotal).toBe(4);
  });

  it("窗口内已完成的 done 任务不进入 todo / in_progress", async () => {
    const { teamA } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);
    const activeTitles = [...board.todo, ...board.inProgress].map(
      (card) => card.title,
    );

    expect(activeTitles).not.toContain("窗口内较新完成");
    expect(activeTitles).not.toContain("窗口下边界完成");
  });

  it("卡片带 projectId / projectName 与子任务计数（2/5），跨项目聚合", async () => {
    const { teamA, growth, alice } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db);
    const todayCard = board.todo.find((card) => card.title === "今天到期")!;

    expect(todayCard).toMatchObject({
      projectId: growth.id,
      projectName: "增长项目",
      subtaskTotal: 5,
      subtaskDone: 2,
      status: "todo",
      completedAt: null,
      assigneeId: alice.id,
      assigneeName: "alice",
    });
    expect(board.todo.find((card) => card.title === "未来到期")).toMatchObject({
      projectName: "留存项目",
    });
  });

  it("只聚合本团队项目任务：团队 B 任务与个人任务不出现，团队 B 看板也不混入团队 A", async () => {
    const { teamA, teamB } = await seedTeamBoard(db);

    const boardA = await getTeamSpaceBoard(teamA.id, TODAY, db);
    const titlesA = [
      ...boardA.todo,
      ...boardA.inProgress,
      ...boardA.doneRecent,
    ].map((card) => card.title);

    expect(titlesA).not.toContain("团队B任务");
    expect(titlesA).not.toContain("个人任务");
    // 团队 A 的全部任务（含未指派）都在。
    expect(boardA.todo).toHaveLength(7);

    const boardB = await getTeamSpaceBoard(teamB.id, TODAY, db);
    expect(boardB.todo.map((card) => card.title)).toEqual(["团队B任务"]);
    expect(boardB.inProgress).toHaveLength(0);
    expect(boardB.doneRecent).toHaveLength(0);
    expect(boardB.doneOlderCount).toBe(0);
    expect(boardB.doneTotal).toBe(0);
  });

  it("getOlderDoneTeamTasks 返回窗口外全部已完成，排序同 done 列（updatedAt 降序），保留 assignee / project", async () => {
    const { teamA, alice } = await seedTeamBoard(db);

    const older = await getOlderDoneTeamTasks(teamA.id, TODAY, db);

    expect(older.map((card) => card.title)).toEqual([
      "窗口上边界完成",
      "很久以前完成",
    ]);
    expect(older[0]).toMatchObject({
      completedAt: OLDER_START.toISOString(),
      projectName: "增长项目",
      status: "done",
      assigneeId: alice.id,
      assigneeName: "alice",
    });
    // 窗口外未指派任务同样保留，assignee 字段为 null。
    expect(older[1]).toMatchObject({
      assigneeId: null,
      assigneeName: null,
      projectName: "留存项目",
    });
  });
});
