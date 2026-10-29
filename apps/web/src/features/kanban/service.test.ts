import type { User } from "@open-doing/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser, requireUser } from "@/features/auth/session";
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

import { getOlderDoneTasksAction } from "./actions";
import {
  getOlderDonePersonalTasks,
  getOlderDoneTeamTasks,
  getPersonalSpaceBoard,
  getTeamSpaceBoard,
} from "./service";

/**
 * action 用例直接调用 Server Action（不起服务器）。
 *
 * action 内部走 `@/server/db/client` 的默认 `db`（模块作用域解析，无法传测试
 * client），这里把该模块的 `db` 劫持为当前用例的测试库实例：Proxy 在每次
 * 属性访问时读取 `testDbRef.current`，从而让 action → service 的默认参数
 * 落到 `TEST_DATABASE_URL` 指向的库。
 *
 * 该模式的前提是 service 通过默认参数**惰性**消费 `db`：若某个 service 在
 * 模块作用域捕获 `db`，这些用例会在 import 阶段因 `db` 未初始化而抛出
 * 「测试数据库未初始化」。
 */
const testDbRef = vi.hoisted(() => ({
  current: null as DbClient | null,
}));

vi.mock("@/server/db/client", () => ({
  db: new Proxy(
    {},
    {
      get(_target, property, receiver) {
        if (!testDbRef.current) {
          throw new Error("测试数据库未初始化：先调用 setupTestDb()");
        }
        return Reflect.get(testDbRef.current, property, receiver);
      },
    },
  ),
}));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return { ...actual, getCurrentUser: vi.fn(), requireUser: vi.fn() };
});

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
    // 三参签名（filter 落在 client 位）走模块默认 `db`，需指向测试库。
    testDbRef.current = db;
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

  it("projectId 过滤：三列与 doneOlderCount / doneTotal 同步收窄到该项目", async () => {
    const { member, study } = await seedBoard(db);

    const board = await getPersonalSpaceBoard(member.id, TODAY, db, {
      projectId: study.id,
    });

    expect(board.todo.map((card) => card.title)).toEqual([
      "逾期较早",
      "今天到期",
      "无截止",
    ]);
    expect(board.inProgress).toHaveLength(0);
    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口下边界完成",
    ]);
    // 学习成长项目窗口外仅 1 条；doneTotal 必须同为过滤后的 2 条，
    // 不能沿用全量 4 条。
    expect(board.doneOlderCount).toBe(1);
    expect(board.doneTotal).toBe(2);
  });

  it("三参签名（filter 落在 client 位，页面实际调用形态）：projectId 过滤与显式传 client 等价", async () => {
    const { member, study } = await seedBoard(db);

    // 页面调用 `getPersonalSpaceBoard(userId, today, filter)`，不显式传 db；
    // 该形态必须解析为「默认 db + filter」，而不是把 filter 误当 client。
    const board = await getPersonalSpaceBoard(member.id, TODAY, {
      projectId: study.id,
    });

    expect(board.todo.map((card) => card.title)).toEqual([
      "逾期较早",
      "今天到期",
      "无截止",
    ]);
    expect(board.inProgress).toHaveLength(0);
    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口下边界完成",
    ]);
    expect(board.doneOlderCount).toBe(1);
    expect(board.doneTotal).toBe(2);
    // 其它项目的卡（含零散任务）一律不出现。
    const titles = [...board.todo, ...board.inProgress].map((c) => c.title);
    expect(titles).not.toContain("逾期较晚");
    expect(titles).not.toContain("未来到期");
    expect(titles).not.toContain("进行中任务");
    expect(titles).not.toContain("零散任务");
  });

  it("getOlderDonePersonalTasks 支持 projectId 过滤（只返回该项目的窗口外 done 卡）", async () => {
    const { member, study } = await seedBoard(db);

    const older = await getOlderDonePersonalTasks(member.id, TODAY, db, {
      projectId: study.id,
    });

    expect(older.map((card) => card.title)).toEqual(["窗口上边界完成"]);
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
 * - 排除项：团队 B 任务、个人空间任务（其一挂在团队 A 项目上，仅靠
 *   `space_type = 'team'` 谓词排除）
 *
 * 团队任务经创建路径保证必有项目（schema 本身不约束），因此不存在零散团队任务。
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
      {
        // 个人空间任务挂在团队 A 的项目上（schema 允许，`tasks.project_id`
        // 可空且无 CHECK 约束 space_type 与项目归属一致）。团队看板按
        // `projects.team_id` 过滤本不会排除它——它缺席只能由
        // `space_type = 'team'` 谓词解释，从而证明该谓词真实生效。
        spaceType: "personal",
        projectId: growth.id,
        title: "团队项目上的个人任务",
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
    // 三参签名（filter 落在 client 位）走模块默认 `db`，需指向测试库。
    testDbRef.current = db;
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

  it("只聚合本团队项目任务：团队 B 任务与个人空间任务不出现，团队 B 看板也不混入团队 A", async () => {
    const { teamA, teamB } = await seedTeamBoard(db);

    const boardA = await getTeamSpaceBoard(teamA.id, TODAY, db);
    const titlesA = [
      ...boardA.todo,
      ...boardA.inProgress,
      ...boardA.doneRecent,
    ].map((card) => card.title);

    expect(titlesA).not.toContain("团队B任务");
    expect(titlesA).not.toContain("个人任务");
    // 「个人任务」因归属个人项目已被 projects.team_id 过滤掉；而「团队项目
    // 上的个人任务」满足 projects.team_id = teamA，只有 space_type 谓词
    // 能把它排除——其缺席证明 space_type 过滤真实生效。
    expect(titlesA).not.toContain("团队项目上的个人任务");
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

  it("projectId 过滤：三列与 doneOlderCount / doneTotal 同步收窄到该项目", async () => {
    const { teamA, growth } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db, {
      projectId: growth.id,
    });

    expect(board.todo.map((card) => card.title)).toEqual([
      "逾期较早",
      "逾期较晚",
      "今天到期",
      "无截止",
    ]);
    expect(board.inProgress.map((card) => card.title)).toEqual(["进行中任务"]);
    expect(board.doneRecent.map((card) => card.title)).toEqual([
      "窗口下边界完成",
    ]);
    expect(board.doneOlderCount).toBe(1);
    expect(board.doneTotal).toBe(2);
  });

  it("unassignedOnly 过滤：列与计数只保留未指派任务", async () => {
    const { teamA } = await seedTeamBoard(db);

    const board = await getTeamSpaceBoard(teamA.id, TODAY, db, {
      unassignedOnly: true,
    });

    // 成员退出后置空的卡也算未指派。
    expect(board.todo.map((card) => card.title)).toEqual([
      "成员退出任务",
      "未指派任务",
    ]);
    expect(board.inProgress).toHaveLength(0);
    expect(board.doneRecent).toHaveLength(0);
    expect(board.doneOlderCount).toBe(1);
    expect(board.doneTotal).toBe(1);
  });

  it("三参签名（filter 落在 client 位，页面实际调用形态）：projectId + unassignedOnly 组合过滤", async () => {
    const { teamA, retention } = await seedTeamBoard(db);

    // 团队页把 `?project={slug}&assignee=unassigned` 解析成组合 filter 传给
    // 本函数（不显式传 db）；两个谓词必须同时生效。
    const board = await getTeamSpaceBoard(teamA.id, TODAY, {
      projectId: retention.id,
      unassignedOnly: true,
    });

    // 留存项目内的未指派卡：两条 todo（其一为成员退出后置空）。
    expect(board.todo.map((card) => card.title)).toEqual([
      "成员退出任务",
      "未指派任务",
    ]);
    expect(board.inProgress).toHaveLength(0);
    expect(board.doneRecent).toHaveLength(0);
    expect(board.doneOlderCount).toBe(1);
    expect(board.doneTotal).toBe(1);
    // 其它项目（增长项目）与已指派的留存卡一律不出现。
    const titles = [...board.todo, ...board.inProgress].map((c) => c.title);
    expect(titles).not.toContain("逾期较早");
    expect(titles).not.toContain("未来到期");
    expect(titles).not.toContain("进行中任务");
  });

  it("getOlderDoneTeamTasks 支持 projectId / unassignedOnly 过滤", async () => {
    const { teamA, growth } = await seedTeamBoard(db);

    const byProject = await getOlderDoneTeamTasks(teamA.id, TODAY, db, {
      projectId: growth.id,
    });
    const unassigned = await getOlderDoneTeamTasks(teamA.id, TODAY, db, {
      unassignedOnly: true,
    });

    expect(byProject.map((card) => card.title)).toEqual(["窗口上边界完成"]);
    expect(unassigned.map((card) => card.title)).toEqual(["很久以前完成"]);
  });
});

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockRequireUser = vi.mocked(requireUser);

/** 会话用户对象（测试只关心 id / username）。 */
function asUser(row: { id: string; username: string }): User {
  return {
    id: row.id,
    uid: "doing_test_user",
    username: row.username,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * action 用例夹具：一个团队（含 owner 成员关系）+ 一个团队项目 + 一个个人项目。
 *
 * done 卡分成两组：
 * - 窗口外：2020 年的两条（永远早于 `today - 6`，不依赖真实时钟）；
 * - 窗口内：`updatedAt` 默认 now（永远落在近 7 天窗口内），用于验证 action
 *   透传的就是「窗口外」结果，而不是全量 done。
 */
async function seedActionFixture(db: DbClient) {
  const alice = await createUser(db, "action-alice");
  const bob = await createUser(db, "action-bob");

  const team = await createTeam(db, {
    ownerId: alice.id,
    name: "行动小队",
    slug: "action-squad",
  });
  await db
    .insert(teamMemberships)
    .values({ teamId: team.id, userId: alice.id, role: "owner" });

  const teamProject = await createTeamProject(db, {
    teamId: team.id,
    name: "行动项目",
    slug: "action-project",
  });
  const personalProject = await createPersonalProject(db, {
    ownerId: alice.id,
    name: "行动个人项目",
    slug: "action-personal",
  });

  await db.insert(tasks).values([
    // ---- 团队：窗口外两条 ----
    {
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队较早完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
      updatedAt: new Date("2020-01-01T00:00:00+08:00"),
    },
    {
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队较晚完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
      updatedAt: new Date("2020-06-01T00:00:00+08:00"),
    },
    // ---- 团队：窗口内 / 未完成（都不应返回） ----
    {
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队近期完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
    },
    {
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队未完成任务",
      status: "todo",
      assigneeId: alice.id,
      createdById: alice.id,
    },
    // ---- 个人：窗口外两条 + 窗口内一条 ----
    {
      spaceType: "personal",
      projectId: personalProject.id,
      title: "个人较早完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
      updatedAt: new Date("2019-01-01T00:00:00+08:00"),
    },
    {
      spaceType: "personal",
      projectId: personalProject.id,
      title: "个人较晚完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
      updatedAt: new Date("2019-05-01T00:00:00+08:00"),
    },
    {
      spaceType: "personal",
      projectId: personalProject.id,
      title: "个人近期完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
    },
  ]);

  return { alice, bob, team, teamProject, personalProject };
}

describe.skipIf(!hasTestDatabase)("展开取数 action（getOlderDoneTasksAction）", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
    vi.resetAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("未登录 team 分支：返回 ok:false「没有权限查看该团队」，不泄露团队信息", async () => {
    const { team } = await seedActionFixture(db);
    mockGetCurrentUser.mockResolvedValue(null);

    const result = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: team.slug,
    });

    expect(result).toEqual({ ok: false, errors: { form: "没有权限查看该团队" } });
  });

  it("team 分支：团队不存在与非成员返回同一错误文案", async () => {
    const { team, bob } = await seedActionFixture(db);
    mockGetCurrentUser.mockResolvedValue(asUser(bob));

    const missing = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: "team-does-not-exist",
    });
    const notMember = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: team.slug,
    });

    expect(missing).toEqual({ ok: false, errors: { form: "没有权限查看该团队" } });
    expect(notMember).toEqual({ ok: false, errors: { form: "没有权限查看该团队" } });
  });

  it("team 分支：成员返回窗口外 done 卡，按 updatedAt 降序（与 getOlderDoneTeamTasks 一致）", async () => {
    const { alice, team, teamProject } = await seedActionFixture(db);
    mockGetCurrentUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: team.slug,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((card) => card.title)).toEqual([
      "团队较晚完成",
      "团队较早完成",
    ]);
    expect(result.data[0]).toMatchObject({
      status: "done",
      projectId: teamProject.id,
      projectName: "行动项目",
      completedAt: new Date("2020-06-01T00:00:00+08:00").toISOString(),
    });
    // 窗口内的 done 与未完成卡都不返回。
    const titles = result.data.map((card) => card.title);
    expect(titles).not.toContain("团队近期完成");
    expect(titles).not.toContain("团队未完成任务");
  });

  it("personal 分支：已登录返回本人的窗口外 done 卡，按 updatedAt 降序", async () => {
    const { alice } = await seedActionFixture(db);
    mockRequireUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({ spaceType: "personal" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((card) => card.title)).toEqual([
      "个人较晚完成",
      "个人较早完成",
    ]);
    expect(result.data[0]).toMatchObject({
      status: "done",
      projectName: "行动个人项目",
      completedAt: new Date("2019-05-01T00:00:00+08:00").toISOString(),
    });
    expect(result.data.map((card) => card.title)).not.toContain("个人近期完成");
  });

  it("personal 分支：projectSlug 过滤只返回该项目的窗口外 done 卡", async () => {
    const { alice } = await seedActionFixture(db);
    const second = await createPersonalProject(db, {
      ownerId: alice.id,
      name: "第二个个人项目",
      slug: "second-personal",
    });
    await db.insert(tasks).values({
      spaceType: "personal",
      projectId: second.id,
      title: "第二个项目较早完成",
      status: "done",
      assigneeId: alice.id,
      createdById: alice.id,
      updatedAt: new Date("2018-01-01T00:00:00+08:00"),
    });
    mockRequireUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({
      spaceType: "personal",
      projectSlug: second.slug,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((card) => card.title)).toEqual([
      "第二个项目较早完成",
    ]);
    expect(result.data[0]).toMatchObject({
      projectId: second.id,
      projectName: "第二个个人项目",
    });
  });

  it("personal 分支：未知 projectSlug 忽略过滤，回退为全部窗口外 done 卡", async () => {
    const { alice } = await seedActionFixture(db);
    mockRequireUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({
      spaceType: "personal",
      projectSlug: "does-not-exist",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((card) => card.title)).toEqual([
      "个人较晚完成",
      "个人较早完成",
    ]);
  });

  it("team 分支：unassignedOnly 只返回未指派的窗口外 done 卡", async () => {
    const { alice, team, teamProject } = await seedActionFixture(db);
    await db.insert(tasks).values({
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队未指派较早完成",
      status: "done",
      assigneeId: null,
      createdById: alice.id,
      updatedAt: new Date("2018-06-01T00:00:00+08:00"),
    });
    mockGetCurrentUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: team.slug,
      unassignedOnly: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((card) => card.title)).toEqual([
      "团队未指派较早完成",
    ]);
    expect(result.data[0]).toMatchObject({
      assigneeId: null,
      assigneeName: null,
    });
  });

  it("team 分支：projectSlug 与 unassignedOnly 组合过滤同时生效", async () => {
    const { alice, bob, team, teamProject } = await seedActionFixture(db);
    // 夹具基础行都在 teamProject 且已指派，这里补一条未指派、一条指派给 bob。
    await db.insert(tasks).values([
      {
        spaceType: "team",
        projectId: teamProject.id,
        title: "组合过滤未指派较早完成",
        status: "done",
        assigneeId: null,
        createdById: alice.id,
        updatedAt: new Date("2018-06-01T00:00:00+08:00"),
      },
      {
        spaceType: "team",
        projectId: teamProject.id,
        title: "组合过滤 bob 指派较早完成",
        status: "done",
        assigneeId: bob.id,
        createdById: alice.id,
        updatedAt: new Date("2018-03-01T00:00:00+08:00"),
      },
    ]);
    mockGetCurrentUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: team.slug,
      projectSlug: teamProject.slug,
      unassignedOnly: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 项目内未指派的窗口外卡返回；同项目已指派卡被 unassignedOnly 排除，
    // 个人项目窗口外卡被 projectSlug 排除。
    expect(result.data.map((card) => card.title)).toEqual([
      "组合过滤未指派较早完成",
    ]);
    expect(result.data[0]).toMatchObject({
      projectId: teamProject.id,
      assigneeId: null,
    });
  });

  it("team 分支：未知 projectSlug 忽略过滤，回退为团队全部窗口外 done 卡", async () => {
    const { alice, team } = await seedActionFixture(db);
    mockGetCurrentUser.mockResolvedValue(asUser(alice));

    const result = await getOlderDoneTasksAction({
      spaceType: "team",
      teamSlug: team.slug,
      projectSlug: "does-not-exist",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((card) => card.title)).toEqual([
      "团队较晚完成",
      "团队较早完成",
    ]);
  });

  it("personal 分支：requireUser 的重定向异常继续冒泡，不被错误映射吞掉", async () => {
    // 模拟未登录时 redirect() 抛出的 NEXT_REDIRECT：action 必须在 try 之外
    // 调用 requireUser，否则会被 toFailure() 映射成通用 form 错误。
    const redirectError = new Error("NEXT_REDIRECT");
    mockRequireUser.mockRejectedValue(redirectError);

    await expect(getOlderDoneTasksAction({ spaceType: "personal" })).rejects.toBe(
      redirectError,
    );
  });
});
