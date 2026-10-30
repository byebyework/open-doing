import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { projects, tasks, teams, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { getPersonalSpaceCalendar, getTeamSpaceCalendar } from "./service";

/**
 * service 通过默认参数 `= db` 惰性消费 `@/server/db/client` 的 `db`；本用例
 * 沿用 kanban `service.test.ts` 的 Proxy 模式：每次属性访问读取
 * `testDbRef.current`，把默认 db 指向当前测试库实例。
 *
 * 所有调用仍显式传入 `db`（与 kanban 用例一致），Proxy 只是保证模块导入
 * 阶段不会创建真实连接池。
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

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[calendar/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/**
 * 基准日 2026-10-01 是周四：
 * - 本周 = 2026-09-28（周一）~ 2026-10-04（周日），跨 9 / 10 两月；
 * - `2026-10` 的 42 天网格 = 2026-09-28 ~ 2026-11-08；
 * - 今天所在月末 = 2026-10-31。
 */
const TODAY = "2026-10-01";
const MONTH = "2026-10";

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
 * 个人空间夹具：覆盖网格两侧、本周跨月两侧、月末 / 次月初、done、无截止、
 * 同日排序、以及他人个人任务 / 团队任务两个排除项。
 *
 * 预期 `items`（dueDate 升序，同日按 createdAt 降序）：
 *   09-28 周一跨月 / 10-01 月初当天 / 10-02 本周已完成(done) /
 *   10-04 周日跨月 / 10-05 月内未来 / 10-10 已完成有期(done) /
 *   10-31 月末 / 11-01 下月初 / 11-05 同日较晚创建 / 11-05 同日较早创建
 * 预期 `weekItems`：[周一跨月, 月初当天, 本周已完成, 周日跨月]
 * 预期 `monthUpcoming`：[月内未来, 月末]
 * 预期 `noDueCount`：2（todo + done 各一条）
 */
async function seedPersonalCalendar(db: DbClient) {
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

  const team = await createTeam(db, {
    ownerId: other.id,
    name: "增长突击队",
    slug: "growth-squad",
  });
  const teamProject = await createTeamProject(db, {
    teamId: team.id,
    name: "增长项目",
    slug: "growth-project",
  });

  await db.insert(tasks).values([
    // ---- 网格窗口内：[2026-09-28, 2026-11-08] ----
    {
      spaceType: "personal",
      projectId: study.id,
      title: "周一跨月",
      status: "todo",
      dueDate: "2026-09-28",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: life.id,
      title: "月初当天",
      status: "todo",
      dueDate: TODAY,
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: study.id,
      title: "本周已完成",
      status: "done",
      dueDate: "2026-10-02",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: life.id,
      title: "周日跨月",
      status: "todo",
      dueDate: "2026-10-04",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: study.id,
      title: "月内未来",
      status: "todo",
      dueDate: "2026-10-05",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: life.id,
      title: "已完成有期",
      status: "done",
      dueDate: "2026-10-10",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: study.id,
      title: "月末",
      status: "todo",
      dueDate: "2026-10-31",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: life.id,
      title: "下月初",
      status: "todo",
      dueDate: "2026-11-01",
      assigneeId: member.id,
      createdById: member.id,
    },
    // ---- 同日排序：dueDate 相同按 createdAt 降序 ----
    {
      spaceType: "personal",
      projectId: study.id,
      title: "同日较早创建",
      status: "todo",
      dueDate: "2026-11-05",
      assigneeId: member.id,
      createdById: member.id,
      createdAt: new Date("2026-10-01T08:00:00+08:00"),
    },
    {
      spaceType: "personal",
      projectId: study.id,
      title: "同日较晚创建",
      status: "todo",
      dueDate: "2026-11-05",
      assigneeId: member.id,
      createdById: member.id,
      createdAt: new Date("2026-10-01T09:00:00+08:00"),
    },
    // ---- 网格窗口外 ----
    {
      spaceType: "personal",
      projectId: life.id,
      title: "网格前",
      status: "todo",
      dueDate: "2026-09-27",
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: life.id,
      title: "网格后",
      status: "todo",
      dueDate: "2026-11-09",
      assigneeId: member.id,
      createdById: member.id,
    },
    // ---- 无截止日期：只进 noDueCount（含 done） ----
    {
      spaceType: "personal",
      projectId: study.id,
      title: "无截止待办",
      status: "todo",
      dueDate: null,
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      spaceType: "personal",
      projectId: life.id,
      title: "无截止完成",
      status: "done",
      dueDate: null,
      assigneeId: member.id,
      createdById: member.id,
    },
    // ---- 排除项 ----
    {
      spaceType: "personal",
      projectId: study.id,
      title: "他人的个人任务",
      status: "todo",
      dueDate: TODAY,
      assigneeId: other.id,
      createdById: other.id,
    },
    {
      spaceType: "team",
      projectId: teamProject.id,
      title: "团队任务",
      status: "todo",
      dueDate: TODAY,
      assigneeId: member.id,
      createdById: other.id,
    },
  ]);

  return { member, other, study, life, team, teamProject };
}

describe.skipIf(!hasTestDatabase)("个人空间日历聚合", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("① 月份网格只含本人的 personal 任务，且 due_date 落在 [grid.start, grid.end]", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);
    const titles = data.items.map((item) => item.title);

    expect(titles).toEqual([
      "周一跨月",
      "月初当天",
      "本周已完成",
      "周日跨月",
      "月内未来",
      "已完成有期",
      "月末",
      "下月初",
      "同日较晚创建",
      "同日较早创建",
    ]);
    // 他人个人任务与团队任务都不属于本人个人空间。
    expect(titles).not.toContain("他人的个人任务");
    expect(titles).not.toContain("团队任务");
  });

  it("② grid 窗口外截止的任务不进 items（前一日 / 后一日）", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);
    const titles = data.items.map((item) => item.title);

    // grid = 2026-09-28 ~ 2026-11-08。
    expect(titles).not.toContain("网格前"); // 2026-09-27
    expect(titles).not.toContain("网格后"); // 2026-11-09
  });

  it("③ done 任务按原 due_date 落格且 done: true", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);
    const byTitle = new Map(data.items.map((item) => [item.title, item]));

    expect(byTitle.get("已完成有期")).toMatchObject({
      dueDate: "2026-10-10",
      done: true,
    });
    expect(byTitle.get("本周已完成")).toMatchObject({
      dueDate: "2026-10-02",
      done: true,
    });
    expect(byTitle.get("月初当天")).toMatchObject({
      dueDate: TODAY,
      done: false,
    });
  });

  it("④ 无截止日期任务只进 noDueCount，不进 items", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);
    const titles = data.items.map((item) => item.title);

    // Ruling 5：计数含任意状态（todo + done 各一条）。
    expect(data.noDueCount).toBe(2);
    expect(titles).not.toContain("无截止待办");
    expect(titles).not.toContain("无截止完成");
  });

  it("⑤ weekItems 为今天所在自然周（周一起 7 天），跨月周两侧边界都进", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);

    // 本周 = 2026-09-28（周一，9 月）~ 2026-10-04（周日，10 月）。
    expect(data.weekItems.map((item) => item.title)).toEqual([
      "周一跨月",
      "月初当天",
      "本周已完成",
      "周日跨月",
    ]);
    expect(data.weekItems[0]!.dueDate).toBe("2026-09-28");
    expect(data.weekItems.at(-1)!.dueDate).toBe("2026-10-04");
    // 本周清单含 done（Ruling 2）。
    expect(data.weekItems.find((item) => item.title === "本周已完成")!.done).toBe(
      true,
    );
  });

  it("⑥ monthUpcoming 排除本周、月末之后与 done", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);
    const titles = data.monthUpcoming.map((item) => item.title);

    // 窗口 = (2026-10-04, 2026-10-31] 且未完成。
    expect(titles).toEqual(["月内未来", "月末"]);
    expect(titles).not.toContain("周日跨月"); // 本周内
    expect(titles).not.toContain("已完成有期"); // done
    expect(titles).not.toContain("下月初"); // 月末之后
    expect(titles).not.toContain("同日较晚创建"); // 月末之后
  });

  it("⑦ 恰为 weekEnd（本周日）的任务只进 weekItems，不进 monthUpcoming", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);

    expect(data.weekItems.map((item) => item.title)).toContain("周日跨月");
    expect(data.monthUpcoming.map((item) => item.title)).not.toContain(
      "周日跨月",
    );
  });

  it("⑧ 排序 dueDate 升序，同日按 createdAt 降序", async () => {
    const { member } = await seedPersonalCalendar(db);

    const data = await getPersonalSpaceCalendar(member.id, MONTH, TODAY, db);
    const dueDates = data.items.map((item) => item.dueDate);
    const sorted = [...dueDates].sort();

    expect(dueDates).toEqual(sorted);
    // 同日两条：后创建者在前。
    const sameDay = data.items
      .filter((item) => item.dueDate === "2026-11-05")
      .map((item) => item.title);
    expect(sameDay).toEqual(["同日较晚创建", "同日较早创建"]);
  });
});

/**
 * 团队空间夹具：团队 A 两个项目 + 团队 B 一个项目。
 *
 * 预期 `items`：[团队周一, 团队未指派, 团队已完成(done), 团队月末]
 * 预期 `weekItems`：[团队周一, 团队未指派]
 * 预期 `monthUpcoming`：[团队月末]（团队已完成是 done）
 * 预期 `noDueCount`：1
 */
async function seedTeamCalendar(db: DbClient) {
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");

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
  await db.insert(tasks).values([
    // ---- 团队 A：网格窗口内 ----
    {
      spaceType: "team",
      projectId: growth.id,
      title: "团队周一",
      status: "todo",
      dueDate: "2026-09-28",
      assigneeId: alice.id,
      createdById: alice.id,
    },
    {
      spaceType: "team",
      projectId: retention.id,
      title: "团队未指派",
      status: "todo",
      dueDate: "2026-10-02",
      assigneeId: null,
      createdById: alice.id,
    },
    {
      spaceType: "team",
      projectId: growth.id,
      title: "团队已完成",
      status: "done",
      dueDate: "2026-10-05",
      assigneeId: alice.id,
      createdById: alice.id,
    },
    {
      spaceType: "team",
      projectId: retention.id,
      title: "团队月末",
      status: "todo",
      dueDate: "2026-10-31",
      assigneeId: bob.id,
      createdById: alice.id,
    },
    {
      spaceType: "team",
      projectId: growth.id,
      title: "团队无截止",
      status: "todo",
      dueDate: null,
      assigneeId: alice.id,
      createdById: alice.id,
    },
    // ---- 排除项：团队 B / 个人空间 ----
    {
      spaceType: "team",
      projectId: defense.id,
      title: "团队B任务",
      status: "todo",
      dueDate: TODAY,
      assigneeId: alice.id,
      createdById: bob.id,
    },
    {
      // 个人任务挂在团队 A 项目上：只有 `space_type = 'team'` 谓词能排除它。
      spaceType: "personal",
      projectId: growth.id,
      title: "团队项目上的个人任务",
      status: "todo",
      dueDate: TODAY,
      assigneeId: alice.id,
      createdById: alice.id,
    },
  ]);

  return { alice, bob, teamA, teamB, growth, retention, defense };
}

describe.skipIf(!hasTestDatabase)("团队空间日历聚合", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("⑨ 团队范围按项目归属，含未指派任务", async () => {
    const { teamA, growth, retention } = await seedTeamCalendar(db);

    const data = await getTeamSpaceCalendar(teamA.id, MONTH, TODAY, db);
    const byTitle = new Map(data.items.map((item) => [item.title, item]));

    expect(data.items.map((item) => item.title)).toEqual([
      "团队周一",
      "团队未指派",
      "团队已完成",
      "团队月末",
    ]);
    // 未指派任务按项目归属纳入，项目名照常取到。
    expect(byTitle.get("团队未指派")).toMatchObject({
      projectId: retention.id,
      projectName: "留存项目",
      assigneeId: null,
      assigneeName: null,
    });
    expect(byTitle.get("团队周一")).toMatchObject({
      projectId: growth.id,
      projectName: "增长项目",
    });
    expect(data.noDueCount).toBe(1);
  });

  it("⑩ assigneeName 来自 users join；未指派为 null", async () => {
    const { alice, bob, teamA } = await seedTeamCalendar(db);

    const data = await getTeamSpaceCalendar(teamA.id, MONTH, TODAY, db);
    const byTitle = new Map(data.items.map((item) => [item.title, item]));

    expect(byTitle.get("团队周一")).toMatchObject({
      assigneeId: alice.id,
      assigneeName: "alice",
    });
    expect(byTitle.get("团队月末")).toMatchObject({
      assigneeId: bob.id,
      assigneeName: "bob",
    });
    expect(byTitle.get("团队未指派")).toMatchObject({
      assigneeId: null,
      assigneeName: null,
    });
  });

  it("⑪ 他人团队任务与个人空间任务不出现", async () => {
    const { teamA, teamB } = await seedTeamCalendar(db);

    const dataA = await getTeamSpaceCalendar(teamA.id, MONTH, TODAY, db);
    const titlesA = [
      ...dataA.items,
      ...dataA.weekItems,
      ...dataA.monthUpcoming,
    ].map((item) => item.title);

    expect(titlesA).not.toContain("团队B任务");
    // 挂在团队 A 项目上的个人任务必须由 space_type 谓词排除。
    expect(titlesA).not.toContain("团队项目上的个人任务");

    const dataB = await getTeamSpaceCalendar(teamB.id, MONTH, TODAY, db);
    expect(dataB.items.map((item) => item.title)).toEqual(["团队B任务"]);
    expect(dataB.weekItems.map((item) => item.title)).toEqual(["团队B任务"]);
    expect(dataB.monthUpcoming).toHaveLength(0);
    expect(dataB.noDueCount).toBe(0);
  });

  it("团队侧栏窗口与个人同口径：本周含 done，本月即将到期排除 done", async () => {
    const { teamA } = await seedTeamCalendar(db);

    const data = await getTeamSpaceCalendar(teamA.id, MONTH, TODAY, db);

    expect(data.weekItems.map((item) => item.title)).toEqual([
      "团队周一",
      "团队未指派",
    ]);
    expect(data.monthUpcoming.map((item) => item.title)).toEqual(["团队月末"]);
  });
});
