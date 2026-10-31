import type { SpaceType, TaskStatus } from "@open-doing/types";
import { isNotNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { projects, tasks, teams, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { getPersonalSpaceAnalysis } from "./service";

/**
 * service 通过默认参数 `= db` 惰性消费 `@/server/db/client` 的 `db`；本用例
 * 沿用 calendar / kanban `service.test.ts` 的 Proxy 模式：每次属性访问读取
 * `testDbRef.current`，把默认 db 指向当前测试库实例。
 *
 * 所有调用仍显式传入 `db`，Proxy 只是保证模块导入阶段不会创建真实连接池。
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
    "[analysis/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/**
 * 基准日 2026-10-30（周五）：
 * - range 30 窗口 = 2026-10-01 ~ 2026-10-30，逐日 30 桶；
 * - range 7 窗口 = 2026-10-24 ~ 2026-10-30，逐日 7 桶；
 * - 按时率固定窗口 = 2026-10-01 ~ 2026-10-30；
 * - 未来截止 14 桶 = 2026-10-30 ~ 2026-11-12。
 */
const TODAY = "2026-10-30";

/** 构造上海时区某天某时刻的 `Date`（写入 timestamptz）。 */
function shanghai(day: string, time = "10:00:00"): Date {
  return new Date(`${day}T${time}+08:00`);
}

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
    .returning({ id: projects.id });
  return row!;
}

async function createTeam(db: DbClient, input: { ownerId: string; name: string; slug: string }) {
  const [row] = await db
    .insert(teams)
    .values({
      name: input.name,
      slug: input.slug,
      ownerId: input.ownerId,
      joinCode: generateJoinCode(),
    })
    .returning({ id: teams.id });
  return row!;
}

async function createTeamProject(
  db: DbClient,
  input: { teamId: string; name: string; slug: string },
) {
  const [row] = await db
    .insert(projects)
    .values({ teamId: input.teamId, name: input.name, slug: input.slug })
    .returning({ id: projects.id });
  return row!;
}

/** 任务夹具：createdAt / updatedAt 必须显式给定，避免依赖数据库 now()。 */
async function createTask(
  db: DbClient,
  input: {
    title: string;
    createdById: string;
    assigneeId?: string | null;
    status?: TaskStatus;
    spaceType?: SpaceType;
    projectId?: string | null;
    dueDate?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  const [row] = await db
    .insert(tasks)
    .values({
      spaceType: input.spaceType ?? "personal",
      projectId: input.projectId ?? null,
      title: input.title,
      status: input.status ?? "todo",
      dueDate: input.dueDate ?? null,
      assigneeId: input.assigneeId ?? input.createdById,
      createdById: input.createdById,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning({ id: tasks.id });
  return row!;
}

describe.skipIf(!hasTestDatabase)("个人空间 Analysis 聚合", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("① 空库：统计全 0、按时率 null、趋势全 0 桶、项目对比为空", async () => {
    const member = await createUser(db, "member");

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    expect(data.stats).toEqual({
      inProgress: 0,
      doneThisMonth: 0,
      overdue: 0,
      onTime: { denominator: 0, onTime: 0, ratePercent: null },
    });

    // range 30 → 30 个逐日桶（含 0）。
    expect(data.completionTrend).toHaveLength(30);
    expect(data.completionTrend[0]).toEqual({ label: "10-01", count: 0 });
    expect(data.completionTrend[29]).toEqual({ label: "10-30", count: 0 });
    expect(data.completionTrend.every((point) => point.count === 0)).toBe(true);

    expect(data.createdVsCompleted).toHaveLength(30);
    expect(
      data.createdVsCompleted.every(
        (point) => point.created === 0 && point.completed === 0,
      ),
    ).toBe(true);

    // 未来截止固定 14 个逐日桶。
    expect(data.futureDue).toHaveLength(14);
    expect(data.futureDue[0]).toEqual({ label: "10-30", count: 0 });
    expect(data.futureDue[13]).toEqual({ label: "11-12", count: 0 });
    expect(data.futureDue.every((point) => point.count === 0)).toBe(true);

    expect(data.projectComparison).toEqual([]);
  });

  it("② 完成趋势按上海完成日落桶；range=7 窗口外不计入", async () => {
    const member = await createUser(db, "member");
    await createTask(db, {
      title: "十月十五完成",
      createdById: member.id,
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-15"),
    });

    const wide = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);
    const wideByLabel = new Map(wide.completionTrend.map((point) => [point.label, point.count]));
    // 上海 2026-10-15 落 10-15 桶（不是 UTC 日期的 10-14/10-15 漂移）。
    expect(wideByLabel.get("10-15")).toBe(1);
    expect(wide.completionTrend.reduce((sum, point) => sum + point.count, 0)).toBe(1);

    // range 7 窗口 = 10-24 ~ 10-30，10-15 不在其中。
    const narrow = await getPersonalSpaceAnalysis(member.id, 7, TODAY, db);
    expect(narrow.completionTrend).toHaveLength(7);
    expect(narrow.completionTrend.every((point) => point.count === 0)).toBe(true);
  });

  it("③ 新增与完成按各自上海日分桶，互不干扰", async () => {
    const member = await createUser(db, "member");

    // 同日创建 + 完成：同一桶两点都计数。
    await createTask(db, {
      title: "同日创建并完成",
      createdById: member.id,
      status: "done",
      createdAt: shanghai("2026-10-10", "09:00:00"),
      updatedAt: shanghai("2026-10-10", "18:00:00"),
    });
    // 只创建未完成：只进 created。
    await createTask(db, {
      title: "只创建",
      createdById: member.id,
      status: "todo",
      createdAt: shanghai("2026-10-12"),
      updatedAt: shanghai("2026-10-12"),
    });
    // 窗口外创建、窗口内完成：只进 completed。
    await createTask(db, {
      title: "窗口外创建窗口内完成",
      createdById: member.id,
      status: "done",
      createdAt: shanghai("2026-09-20"),
      updatedAt: shanghai("2026-10-13"),
    });

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);
    const byLabel = new Map(data.createdVsCompleted.map((point) => [point.label, point]));

    expect(byLabel.get("10-10")).toEqual({ label: "10-10", created: 1, completed: 1 });
    expect(byLabel.get("10-12")).toEqual({ label: "10-12", created: 1, completed: 0 });
    // 09-20 不在窗口内：该桶 created 必须为 0，completed 只来自完成日。
    expect(byLabel.get("10-13")).toEqual({ label: "10-13", created: 0, completed: 1 });

    expect(data.createdVsCompleted.reduce((sum, point) => sum + point.created, 0)).toBe(2);
    expect(data.createdVsCompleted.reduce((sum, point) => sum + point.completed, 0)).toBe(2);
  });

  it("④ 按时率固定近 30 天：分母只含有截止的 done，ratePercent 四舍五入", async () => {
    const member = await createUser(db, "member");

    // 按时：完成日 = 截止日。
    await createTask(db, {
      title: "按时完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-10-20",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-19"),
    });
    // 按时：完成日 = 截止日边界（<= 含等号）。
    await createTask(db, {
      title: "截止当天完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-10-25",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-25"),
    });
    // 逾期完成：完成日晚于截止日。
    await createTask(db, {
      title: "逾期完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-10-10",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-11"),
    });
    // 无截止：不进分母。
    await createTask(db, {
      title: "无截止完成",
      createdById: member.id,
      status: "done",
      dueDate: null,
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-15"),
    });
    // 固定窗口外（09-20 完成）：即使按时也不进分母。
    await createTask(db, {
      title: "窗口外按时完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-09-21",
      createdAt: shanghai("2026-09-01"),
      updatedAt: shanghai("2026-09-20"),
    });
    // 边界：完成日恰为 today-29（2026-10-01）→ 进分母。
    // 若窗口起点被误写成 today-30（09-30），下面这条 09-30 完成会混入分母。
    await createTask(db, {
      title: "窗口起点完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-10-05",
      createdAt: shanghai("2026-09-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    // 边界：完成日恰为 today-30（2026-09-30）→ 不进分母。
    await createTask(db, {
      title: "窗口前一天完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-10-01",
      createdAt: shanghai("2026-09-01"),
      updatedAt: shanghai("2026-09-30"),
    });

    // 用 range=7 调用：按时率固定近 30 天，不随 range 缩小。
    // 分母 = 10-19 / 10-25 / 10-11 / 10-01 四条有截止的 done；09-30 与 09-20 被窗口排除。
    const data = await getPersonalSpaceAnalysis(member.id, 7, TODAY, db);
    expect(data.stats.onTime).toEqual({
      denominator: 4,
      onTime: 3,
      ratePercent: 75,
    });

    // 删除全部有截止的任务后：分母 0 → ratePercent null（无除零 / NaN）。
    await db.delete(tasks).where(isNotNull(tasks.dueDate));
    const after = await getPersonalSpaceAnalysis(member.id, 7, TODAY, db);
    expect(after.stats.onTime).toEqual({
      denominator: 0,
      onTime: 0,
      ratePercent: null,
    });
  });

  it("⑤ overdue：未完成且 dueDate < today（当天不算），done 不算", async () => {
    const member = await createUser(db, "member");

    await createTask(db, {
      title: "昨天到期未完成",
      createdById: member.id,
      dueDate: "2026-10-29",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    await createTask(db, {
      title: "今天到期",
      createdById: member.id,
      dueDate: "2026-10-30",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    await createTask(db, {
      title: "进行中已逾期",
      createdById: member.id,
      status: "in_progress",
      dueDate: "2026-10-28",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    await createTask(db, {
      title: "过去已完成的截止",
      createdById: member.id,
      status: "done",
      dueDate: "2026-10-01",
      createdAt: shanghai("2026-09-01"),
      updatedAt: shanghai("2026-09-30"),
    });
    // 本月完成（上海 10-05）：`doneThisMonth` 应为非 0。
    await createTask(db, {
      title: "本月完成",
      createdById: member.id,
      status: "done",
      dueDate: null,
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-05"),
    });

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    // 昨天到期 + 进行中逾期 = 2；今天到期、done 过期任务都不算。
    expect(data.stats.overdue).toBe(2);
    // 进行中 1 条；本月完成 1 条（09-30 完成的旧任务不算本月）。
    expect(data.stats.inProgress).toBe(1);
    expect(data.stats.doneThisMonth).toBe(1);
  });

  it("⑥ futureDue：未完成且 dueDate ∈ [today, today+13]，首末桶含端点", async () => {
    const member = await createUser(db, "member");

    await createTask(db, {
      title: "今天到期",
      createdById: member.id,
      dueDate: "2026-10-30",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    await createTask(db, {
      title: "末桶到期",
      createdById: member.id,
      dueDate: "2026-11-12",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    // 说明：查询里的 `lte(tasks.dueDate, futureEnd)` 是 SQL 侧纵深防御。
    // 即使去掉该条件，窗口外的日期也会被 `bucketIndexForDay` 丢弃（返回 -1），
    // 输出层无法观察到差异——本夹具只作语义备忘，上界保护由 SQL 条件承担。
    await createTask(db, {
      title: "超出窗口",
      createdById: member.id,
      dueDate: "2026-11-13",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    await createTask(db, {
      title: "未来但已完成",
      createdById: member.id,
      status: "done",
      dueDate: "2026-11-01",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });
    await createTask(db, {
      title: "已逾期不进入未来分布",
      createdById: member.id,
      dueDate: "2026-10-29",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-01"),
    });

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    expect(data.futureDue).toHaveLength(14);
    expect(data.futureDue[0]).toEqual({ label: "10-30", count: 1 });
    expect(data.futureDue[13]).toEqual({ label: "11-12", count: 1 });
    expect(data.futureDue.reduce((sum, point) => sum + point.count, 0)).toBe(2);
  });

  it("⑦ projectComparison：doneCount 降序、projectName 升序，无项目为空串，他人任务不计入", async () => {
    const member = await createUser(db, "member");
    const other = await createUser(db, "other");
    const alpha = await createPersonalProject(db, {
      ownerId: member.id,
      name: "Alpha",
      slug: "alpha",
    });
    const beta = await createPersonalProject(db, {
      ownerId: member.id,
      name: "Beta",
      slug: "beta",
    });

    const seedDone = (input: {
      title: string;
      assigneeId: string;
      projectId?: string | null;
      updatedAt: Date;
    }) =>
      createTask(db, {
        title: input.title,
        createdById: member.id,
        assigneeId: input.assigneeId,
        status: "done",
        projectId: input.projectId ?? null,
        createdAt: shanghai("2026-10-01"),
        updatedAt: input.updatedAt,
      });

    // Alpha 2 条、Beta 1 条、无项目 1 条。
    await seedDone({ title: "Alpha 一", assigneeId: member.id, projectId: alpha.id, updatedAt: shanghai("2026-10-05") });
    await seedDone({ title: "Alpha 二", assigneeId: member.id, projectId: alpha.id, updatedAt: shanghai("2026-10-06") });
    await seedDone({ title: "Beta 一", assigneeId: member.id, projectId: beta.id, updatedAt: shanghai("2026-10-07") });
    await seedDone({ title: "零散完成", assigneeId: member.id, projectId: null, updatedAt: shanghai("2026-10-08") });
    // 他人任务：即使挂在 Alpha、且完成日在窗口内，也不计入。
    await seedDone({ title: "他人完成", assigneeId: other.id, projectId: alpha.id, updatedAt: shanghai("2026-10-09") });
    // 窗口外完成：不计入。
    await seedDone({ title: "窗口外完成", assigneeId: member.id, projectId: alpha.id, updatedAt: shanghai("2026-09-15") });

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    expect(data.projectComparison).toEqual([
      { projectId: alpha.id, projectName: "Alpha", doneCount: 2 },
      // doneCount 相同（1）时按 projectName 升序：空串在 "Beta" 之前。
      { projectId: null, projectName: "", doneCount: 1 },
      { projectId: beta.id, projectName: "Beta", doneCount: 1 },
    ]);
  });

  it("⑧ 范围谓词只看 assigneeId：指派给我的团队任务计入，他人的个人任务不计入", async () => {
    const member = await createUser(db, "member");
    const other = await createUser(db, "other");
    const team = await createTeam(db, {
      ownerId: member.id,
      name: "增长突击队",
      slug: "growth-squad",
    });
    const teamProject = await createTeamProject(db, {
      teamId: team.id,
      name: "团队项目",
      slug: "growth",
    });

    await createTask(db, {
      title: "指派给我的团队完成",
      createdById: other.id,
      assigneeId: member.id,
      spaceType: "team",
      projectId: teamProject.id,
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-05"),
    });
    await createTask(db, {
      title: "他人的个人完成",
      createdById: other.id,
      assigneeId: other.id,
      spaceType: "personal",
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-05"),
    });

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    expect(data.completionTrend.reduce((sum, point) => sum + point.count, 0)).toBe(1);
    expect(data.projectComparison).toEqual([
      { projectId: teamProject.id, projectName: "团队项目", doneCount: 1 },
    ]);
  });

  it("⑨ 范围谓词覆盖 stats / createdVsCompleted / futureDue：他人任务不进任何聚合", async () => {
    const member = await createUser(db, "member");
    const other = await createUser(db, "other");

    // 给 member 与 other 各造一组形状相同的任务：只要任一查询漏掉
    // `eq(tasks.assigneeId, userId)`，计数就会翻倍 / 对对碰。
    const seedScopeFixture = async (ownerId: string) => {
      await createTask(db, { title: "进行中", createdById: ownerId, assigneeId: ownerId, status: "in_progress", createdAt: shanghai("2026-10-01"), updatedAt: shanghai("2026-10-01") });
      await createTask(db, { title: "逾期", createdById: ownerId, assigneeId: ownerId, dueDate: "2026-10-29", createdAt: shanghai("2026-10-01"), updatedAt: shanghai("2026-10-01") });
      await createTask(db, { title: "未来到期", createdById: ownerId, assigneeId: ownerId, dueDate: "2026-11-02", createdAt: shanghai("2026-10-01"), updatedAt: shanghai("2026-10-01") });
      await createTask(db, { title: "窗口内创建", createdById: ownerId, assigneeId: ownerId, createdAt: shanghai("2026-10-20"), updatedAt: shanghai("2026-10-20") });
    };
    await seedScopeFixture(member.id);
    await seedScopeFixture(other.id);

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    // 进行中 / 逾期各恰好 1（member 的那条）。
    expect(data.stats.inProgress).toBe(1);
    expect(data.stats.overdue).toBe(1);

    // 4 条 member 任务均在窗口内创建；other 的 4 条不得计入。
    const createdByLabel = new Map(
      data.createdVsCompleted.map((point) => [point.label, point.created]),
    );
    expect(data.createdVsCompleted.reduce((sum, point) => sum + point.created, 0)).toBe(4);
    expect(createdByLabel.get("10-20")).toBe(1);

    // 未来到期分布只有 member 的 1 条。
    expect(data.futureDue.reduce((sum, point) => sum + point.count, 0)).toBe(1);
  });

  it("⑩ 上海日换算跨 UTC 日期边界：完成日 / 创建日按 Asia/Shanghai 归属", async () => {
    const member = await createUser(db, "member");
    // 上海 2026-10-15 00:30 = UTC 2026-10-14T16:30Z；
    // 上海 2026-10-16 00:30 = UTC 2026-10-15T16:30Z。
    // 若 SQL 漏掉 `AT TIME ZONE 'Asia/Shanghai'`（会话时区 UTC），两条会
    // 各自提前一天落到 10-14 / 10-15。
    await createTask(db, {
      title: "跨 UTC 边界完成",
      createdById: member.id,
      status: "done",
      createdAt: shanghai("2026-10-16", "00:30:00"),
      updatedAt: shanghai("2026-10-15", "00:30:00"),
    });

    const data = await getPersonalSpaceAnalysis(member.id, 30, TODAY, db);

    const trendByLabel = new Map(
      data.completionTrend.map((point) => [point.label, point.count]),
    );
    expect(trendByLabel.get("10-15")).toBe(1);
    expect(trendByLabel.get("10-14")).toBe(0);

    const byLabel = new Map(data.createdVsCompleted.map((point) => [point.label, point]));
    expect(byLabel.get("10-16")).toEqual({ label: "10-16", created: 1, completed: 0 });
    expect(byLabel.get("10-15")).toEqual({ label: "10-15", created: 0, completed: 1 });
    expect(byLabel.get("10-14")).toEqual({ label: "10-14", created: 0, completed: 0 });
  });
});
