import type { SpaceType, TaskStatus } from "@open-doing/types";
import { isNotNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  projects,
  tasks,
  teamMemberships,
  teams,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { getPersonalSpaceAnalysis, getTeamSpaceAnalysis } from "./service";

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
    .returning({ id: teams.id, slug: teams.slug });
  return row!;
}

async function createTeamProject(
  db: DbClient,
  input: { teamId: string; name: string; slug: string; createdAt?: Date },
) {
  const [row] = await db
    .insert(projects)
    .values({
      teamId: input.teamId,
      name: input.name,
      slug: input.slug,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: projects.id });
  return row!;
}

/** 团队成员关系夹具：joinedAt 显式给定，保证 `listMembers` 的排序稳定。 */
async function addTeamMember(
  db: DbClient,
  input: {
    teamId: string;
    userId: string;
    role: "owner" | "admin" | "member";
    joinedAt: Date;
  },
) {
  await db.insert(teamMemberships).values({
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    joinedAt: input.joinedAt,
  });
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
      // 显式 `null` 表示未指派；只有省略字段时才回落到创建人。
      assigneeId:
        input.assigneeId === undefined ? input.createdById : input.assigneeId,
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

/**
 * 团队空间基准日同个人空间：2026-10-30（周五）。
 * - 本周一（上海）= 2026-10-26；
 * - 近 6 周桶 = 09-21 / 09-28 / 10-05 / 10-12 / 10-19 / 10-26（末桶下标 5）；
 * - range 90 窗口起点 = 08-02（周日），首周桶从所在周周一 07-27 起，共 14 桶；
 * - 僵尸边界 = 2026-10-16 上海零点。
 */
describe.skipIf(!hasTestDatabase)("团队空间 Analysis 聚合", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("① 空团队：统计全 0、吞吐全 0 桶、成员负载全 0、无项目 / 僵尸", async () => {
    const owner = await createUser(db, "林夏");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    await addTeamMember(db, {
      teamId: team.id,
      userId: owner.id,
      role: "owner",
      joinedAt: shanghai("2026-10-01"),
    });

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    expect(data.stats).toEqual({
      projectCount: 0,
      avgProgressPercent: 0,
      overdue: 0,
      doneThisWeek: 0,
    });
    expect(data.throughput).toHaveLength(30);
    expect(data.throughput[0]).toEqual({ label: "10-01", count: 0 });
    expect(data.throughput[29]).toEqual({ label: "10-30", count: 0 });
    expect(data.throughput.every((point) => point.count === 0)).toBe(true);
    expect(data.members).toEqual([
      {
        userId: owner.id,
        username: "林夏",
        inProgress: 0,
        dueSoon: 0,
        overdue: 0,
      },
    ]);
    expect(data.projectHealth).toEqual([]);
    expect(data.zombieTasks).toEqual([]);
  });

  it("② 快照映射：手算 avgProgressPercent、成员负载与项目健康度透传", async () => {
    const owner = await createUser(db, "林夏");
    const member = await createUser(db, "阿泽");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    // 成员加入顺序决定 members 行序：owner 在前。
    await addTeamMember(db, {
      teamId: team.id,
      userId: owner.id,
      role: "owner",
      joinedAt: shanghai("2026-10-01"),
    });
    await addTeamMember(db, {
      teamId: team.id,
      userId: member.id,
      role: "member",
      joinedAt: shanghai("2026-10-02"),
    });

    // 项目 createdAt 显式给定：getTeamOverview 按 createdAt 升序输出。
    const product = await createTeamProject(db, {
      teamId: team.id,
      name: "产品迭代",
      slug: "product",
      createdAt: shanghai("2026-10-01", "09:00:00"),
    });
    const growth = await createTeamProject(db, {
      teamId: team.id,
      name: "增长实验",
      slug: "growth",
      createdAt: shanghai("2026-10-02", "09:00:00"),
    });
    const empty = await createTeamProject(db, {
      teamId: team.id,
      name: "空项目",
      slug: "empty",
      createdAt: shanghai("2026-10-03", "09:00:00"),
    });

    // 产品迭代：done(1) + in_progress(0.5) + todo(0) → 项目进度 0.5。
    await createTask(db, {
      title: "产品完成",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "team",
      projectId: product.id,
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-27"),
    });
    await createTask(db, {
      title: "产品进行中",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "team",
      projectId: product.id,
      status: "in_progress",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-28"),
    });
    await createTask(db, {
      title: "产品逾期待办",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "team",
      projectId: product.id,
      status: "todo",
      dueDate: "2026-10-29",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-29"),
    });
    // 增长实验：单条 in_progress(0.5)，明天到期 → hasDueSoon。
    await createTask(db, {
      title: "增长进行中",
      createdById: owner.id,
      assigneeId: member.id,
      spaceType: "team",
      projectId: growth.id,
      status: "in_progress",
      dueDate: "2026-10-31",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-28"),
    });

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    // 四条任务进度 1 + 0.5 + 0 + 0.5 = 2 → 平均 0.5 → 50%（手算，不引用 overview 输出）。
    expect(data.stats).toEqual({
      projectCount: 3,
      avgProgressPercent: 50,
      overdue: 1,
      doneThisWeek: 1,
    });

    // 成员负载逐行裁成 DTO（丢弃 tasks / href）。
    expect(data.members).toEqual([
      {
        userId: owner.id,
        username: "林夏",
        inProgress: 1,
        dueSoon: 0,
        overdue: 1,
      },
      {
        userId: member.id,
        username: "阿泽",
        inProgress: 1,
        dueSoon: 1,
        overdue: 0,
      },
    ]);

    expect(data.projectHealth).toEqual([
      {
        projectId: product.id,
        projectName: "产品迭代",
        progressPercent: 50,
        hasOverdue: true,
        hasDueSoon: false,
        taskCount: 3,
        doneCount: 1,
        weeklyDone: [0, 0, 0, 0, 0, 1],
      },
      {
        projectId: growth.id,
        projectName: "增长实验",
        progressPercent: 50,
        hasOverdue: false,
        hasDueSoon: true,
        taskCount: 1,
        doneCount: 0,
        weeklyDone: [0, 0, 0, 0, 0, 0],
      },
      {
        projectId: empty.id,
        projectName: "空项目",
        progressPercent: 0,
        hasOverdue: false,
        hasDueSoon: false,
        taskCount: 0,
        doneCount: 0,
        weeklyDone: [0, 0, 0, 0, 0, 0],
      },
    ]);

    // 吞吐与完成趋势同法：10-27 完成 1 条。
    expect(
      data.throughput.reduce((sum, point) => sum + point.count, 0),
    ).toBe(1);
  });

  it("③ doneThisWeek：本周一上海零点起算，上周 / 非 done / 他空间不计数", async () => {
    const owner = await createUser(db, "林夏");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    const project = await createTeamProject(db, {
      teamId: team.id,
      name: "主项目",
      slug: "main",
    });

    const seedDone = (title: string, updatedAt: Date) =>
      createTask(db, {
        title,
        createdById: owner.id,
        assigneeId: owner.id,
        spaceType: "team",
        projectId: project.id,
        status: "done",
        createdAt: shanghai("2026-10-01"),
        updatedAt,
      });

    // 本周一边界：上海 2026-10-26 00:00 整计入。
    await seedDone("本周一零点整", shanghai("2026-10-26", "00:00:00"));
    // 上海 00:30 = UTC 前一日 16:30：若漏掉 `AT TIME ZONE 'Asia/Shanghai'`
    // 且会话时区为 UTC，这条会被错判到上周。
    await seedDone("本周一凌晨", shanghai("2026-10-26", "00:30:00"));
    // 上周日深夜：上周起点之前，不计数。
    await seedDone("上周日深夜", shanghai("2026-10-25", "23:59:59"));
    await seedDone("上周完成", shanghai("2026-10-20"));

    // 非 done 即使本周更新也不计数。
    await createTask(db, {
      title: "本周更新进行中",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "team",
      projectId: project.id,
      status: "in_progress",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-28"),
    });

    // 其他团队的 done 与本团队无关。
    const otherTeam = await createTeam(db, {
      ownerId: owner.id,
      name: "别的团队",
      slug: "other-team",
    });
    const otherProject = await createTeamProject(db, {
      teamId: otherTeam.id,
      name: "别队项目",
      slug: "other",
    });
    await createTask(db, {
      title: "他队完成",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "team",
      projectId: otherProject.id,
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-28"),
    });

    // 个人任务不属于 teamScope。
    await createTask(db, {
      title: "个人完成",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "personal",
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-28"),
    });

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    expect(data.stats.doneThisWeek).toBe(2);
  });

  it("④ throughput：range 窗口边界归属；range=90 为周桶（桶数按周公式）", async () => {
    const owner = await createUser(db, "林夏");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    const project = await createTeamProject(db, {
      teamId: team.id,
      name: "主项目",
      slug: "main",
    });

    const seedDone = (title: string, updatedAt: Date) =>
      createTask(db, {
        title,
        createdById: owner.id,
        assigneeId: owner.id,
        spaceType: "team",
        projectId: project.id,
        status: "done",
        createdAt: shanghai("2026-07-01"),
        updatedAt,
      });

    // range 7 窗口起点（10-24）与前一天（10-23）。
    await seedDone("七天窗口起点", shanghai("2026-10-24", "12:00:00"));
    await seedDone("七天窗口前一天", shanghai("2026-10-23", "12:00:00"));
    // range 30 窗口起点（10-01）前一天（09-30）。
    await seedDone("三十天窗口前一天", shanghai("2026-09-30", "12:00:00"));
    // range 90 窗口起点（08-02）与前一天（08-01）。
    await seedDone("九十天窗口起点", shanghai("2026-08-02", "12:00:00"));
    await seedDone("九十天窗口前一天", shanghai("2026-08-01", "12:00:00"));

    const seven = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 7, today: TODAY },
      db,
    );
    expect(seven.throughput).toHaveLength(7);
    expect(seven.throughput[0]).toEqual({ label: "10-24", count: 1 });
    expect(seven.throughput.every((point, index) => point.count === (index === 0 ? 1 : 0))).toBe(true);

    const thirty = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );
    const thirtyByLabel = new Map(
      thirty.throughput.map((point) => [point.label, point.count]),
    );
    expect(thirty.throughput).toHaveLength(30);
    expect(thirtyByLabel.get("10-24")).toBe(1);
    expect(thirtyByLabel.get("10-23")).toBe(1);
    // 09-30 是 30 天窗口起点（10-01）前一天，只能落在 90 天窗口。
    expect(thirtyByLabel.has("09-30")).toBe(false);
    expect(
      thirty.throughput.reduce((sum, point) => sum + point.count, 0),
    ).toBe(2);

    const ninety = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 90, today: TODAY },
      db,
    );
    const ninetyByLabel = new Map(
      ninety.throughput.map((point) => [point.label, point.count]),
    );
    // 周桶数 = floor(daysBetween("2026-07-27", "2026-10-30") / 7) + 1
    //        = floor(95 / 7) + 1 = 14。
    expect(ninety.throughput).toHaveLength(14);
    expect(ninety.throughput[0]).toEqual({ label: "07-27", count: 1 });
    expect(ninety.throughput[13]).toEqual({ label: "10-26", count: 0 });
    expect(ninetyByLabel.get("09-28")).toBe(1);
    expect(ninetyByLabel.get("10-19")).toBe(2);
    expect(
      ninety.throughput.reduce((sum, point) => sum + point.count, 0),
    ).toBe(4);
  });

  it("⑤ weeklyDone：末桶为本周、上周落前桶；六周窗口外不计入 doneCount", async () => {
    const owner = await createUser(db, "林夏");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    const alpha = await createTeamProject(db, {
      teamId: team.id,
      name: "项目甲",
      slug: "alpha",
      createdAt: shanghai("2026-10-01", "09:00:00"),
    });
    const beta = await createTeamProject(db, {
      teamId: team.id,
      name: "项目乙",
      slug: "beta",
      createdAt: shanghai("2026-10-02", "09:00:00"),
    });

    const seedDone = (title: string, projectId: string, updatedAt: Date) =>
      createTask(db, {
        title,
        createdById: owner.id,
        assigneeId: owner.id,
        spaceType: "team",
        projectId,
        status: "done",
        createdAt: shanghai("2026-09-01"),
        updatedAt,
      });

    // 项目甲：本周 2、上周 1、10-05 周 1。
    await seedDone("本周一完成", alpha.id, shanghai("2026-10-27", "10:00:00"));
    await seedDone("本周四完成", alpha.id, shanghai("2026-10-29", "10:00:00"));
    await seedDone("上周完成", alpha.id, shanghai("2026-10-20", "10:00:00"));
    await seedDone("更早一周完成", alpha.id, shanghai("2026-10-07", "10:00:00"));
    // 六周窗口起点（09-21）前一天：不计入 doneCount / weeklyDone。
    await seedDone("窗口外完成", alpha.id, shanghai("2026-09-20", "10:00:00"));

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    expect(data.projectHealth).toEqual([
      {
        projectId: alpha.id,
        projectName: "项目甲",
        progressPercent: 100,
        hasOverdue: false,
        hasDueSoon: false,
        taskCount: 5,
        doneCount: 4,
        weeklyDone: [0, 0, 1, 0, 1, 2],
      },
      {
        projectId: beta.id,
        projectName: "项目乙",
        progressPercent: 0,
        hasOverdue: false,
        hasDueSoon: false,
        taskCount: 0,
        doneCount: 0,
        weeklyDone: [0, 0, 0, 0, 0, 0],
      },
    ]);
  });

  it("⑥ 僵尸任务：today-15 出现且 stalledDays=15，today-14 凌晨不出现；状态 / 空间 / 指派过滤", async () => {
    const owner = await createUser(db, "林夏");
    const member = await createUser(db, "阿泽");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    const project = await createTeamProject(db, {
      teamId: team.id,
      name: "主项目",
      slug: "main",
    });

    const seed = (input: {
      title: string;
      assigneeId?: string | null;
      status?: "todo" | "in_progress" | "done";
      spaceType?: "personal" | "team";
      projectId?: string | null;
      updatedAt: Date;
    }) =>
      createTask(db, {
        title: input.title,
        createdById: owner.id,
        assigneeId: input.assigneeId,
        spaceType: input.spaceType ?? "team",
        projectId: input.projectId === undefined ? project.id : input.projectId,
        status: input.status ?? "in_progress",
        createdAt: shanghai("2026-09-01"),
        updatedAt: input.updatedAt,
      });

    // 插入顺序故意打乱，排序必须由 updatedAt 决定。
    const z2 = await seed({ title: "停留十五天", assigneeId: owner.id, updatedAt: shanghai("2026-10-15", "23:00:00") });
    const z1 = await seed({ title: "停留十六天", assigneeId: owner.id, updatedAt: shanghai("2026-10-14", "10:00:00") });
    const boundary = await seed({ title: "边界当日凌晨", assigneeId: owner.id, updatedAt: shanghai("2026-10-16", "00:05:00") });
    const z3 = await seed({ title: "未指派僵尸", assigneeId: null, updatedAt: shanghai("2026-10-15", "09:00:00") });
    // 上海 10-15 00:30 = UTC 10-14 16:30：stalledDays 必须按上海日算。
    const z4 = await seed({ title: "凌晨更新仍十五天", assigneeId: member.id, updatedAt: shanghai("2026-10-15", "00:30:00") });

    // 非僵尸：状态不对、空间不对、团队不对。
    await seed({ title: "陈年待办", status: "todo", assigneeId: owner.id, updatedAt: shanghai("2026-10-01") });
    await seed({ title: "陈年完成", status: "done", assigneeId: owner.id, updatedAt: shanghai("2026-10-01") });
    await seed({ title: "个人进行中", spaceType: "personal", projectId: null, assigneeId: owner.id, updatedAt: shanghai("2026-10-01") });
    const otherTeam = await createTeam(db, {
      ownerId: owner.id,
      name: "别的团队",
      slug: "other-team",
    });
    const otherProject = await createTeamProject(db, {
      teamId: otherTeam.id,
      name: "别队项目",
      slug: "other",
    });
    await seed({ title: "他队进行中", projectId: otherProject.id, assigneeId: owner.id, updatedAt: shanghai("2026-10-01") });

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    expect(data.zombieTasks.map((task) => task.id)).toEqual([
      z1.id,
      z4.id,
      z3.id,
      z2.id,
    ]);
    expect(data.zombieTasks).toEqual([
      {
        id: z1.id,
        title: "停留十六天",
        projectName: "主项目",
        assigneeName: "林夏",
        stalledDays: 16,
      },
      {
        id: z4.id,
        title: "凌晨更新仍十五天",
        projectName: "主项目",
        assigneeName: "阿泽",
        stalledDays: 15,
      },
      {
        id: z3.id,
        title: "未指派僵尸",
        projectName: "主项目",
        assigneeName: null,
        stalledDays: 15,
      },
      {
        id: z2.id,
        title: "停留十五天",
        projectName: "主项目",
        assigneeName: "林夏",
        stalledDays: 15,
      },
    ]);
    expect(data.zombieTasks.some((task) => task.id === boundary.id)).toBe(false);
  });

  it("⑦ 僵尸任务最多 10 条：按 updatedAt 升序保留最久 10 条", async () => {
    const owner = await createUser(db, "林夏");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    const project = await createTeamProject(db, {
      teamId: team.id,
      name: "主项目",
      slug: "main",
    });

    const seeded: { id: string; title: string }[] = [];
    // 倒序插入 12 条（00:00 ~ 11:00），输出的前 10 条应为 00~09。
    for (let hour = 11; hour >= 0; hour--) {
      const title = `僵尸 ${String(hour).padStart(2, "0")}`;
      const row = await createTask(db, {
        title,
        createdById: owner.id,
        assigneeId: owner.id,
        spaceType: "team",
        projectId: project.id,
        status: "in_progress",
        createdAt: shanghai("2026-09-01"),
        updatedAt: shanghai("2026-10-15", `${String(hour).padStart(2, "0")}:00:00`),
      });
      seeded.push({ id: row.id, title });
    }
    const byId = new Map(seeded.map((task) => [task.id, task.title]));

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    expect(data.zombieTasks).toHaveLength(10);
    expect(data.zombieTasks.map((task) => byId.get(task.id))).toEqual([
      "僵尸 00",
      "僵尸 01",
      "僵尸 02",
      "僵尸 03",
      "僵尸 04",
      "僵尸 05",
      "僵尸 06",
      "僵尸 07",
      "僵尸 08",
      "僵尸 09",
    ]);
    expect(data.zombieTasks.every((task) => task.stalledDays === 15)).toBe(true);
  });

  it("⑧ 吞吐口径：未指派的团队 done 计入，个人 / 他队 done 不计入", async () => {
    const owner = await createUser(db, "林夏");
    const team = await createTeam(db, {
      ownerId: owner.id,
      name: "分析小队",
      slug: "analysis-squad",
    });
    const project = await createTeamProject(db, {
      teamId: team.id,
      name: "主项目",
      slug: "main",
    });

    // 未指派团队 done：teamScope 不看 assignee。
    await createTask(db, {
      title: "未指派完成",
      createdById: owner.id,
      assigneeId: null,
      spaceType: "team",
      projectId: project.id,
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-27", "10:00:00"),
    });
    // 个人 done 不属于 teamScope。
    await createTask(db, {
      title: "个人完成",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "personal",
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-28", "10:00:00"),
    });
    // 他队 done 不属于本团队。
    const otherTeam = await createTeam(db, {
      ownerId: owner.id,
      name: "别的团队",
      slug: "other-team",
    });
    const otherProject = await createTeamProject(db, {
      teamId: otherTeam.id,
      name: "别队项目",
      slug: "other",
    });
    await createTask(db, {
      title: "他队完成",
      createdById: owner.id,
      assigneeId: owner.id,
      spaceType: "team",
      projectId: otherProject.id,
      status: "done",
      createdAt: shanghai("2026-10-01"),
      updatedAt: shanghai("2026-10-27", "10:00:00"),
    });

    const data = await getTeamSpaceAnalysis(
      { teamId: team.id, teamSlug: team.slug, range: 30, today: TODAY },
      db,
    );

    const throughputByLabel = new Map(
      data.throughput.map((point) => [point.label, point.count]),
    );
    expect(throughputByLabel.get("10-27")).toBe(1);
    expect(
      data.throughput.reduce((sum, point) => sum + point.count, 0),
    ).toBe(1);
    expect(data.stats.doneThisWeek).toBe(1);
    expect(data.projectHealth).toEqual([
      {
        projectId: project.id,
        projectName: "主项目",
        progressPercent: 100,
        hasOverdue: false,
        hasDueSoon: false,
        taskCount: 1,
        doneCount: 1,
        weeklyDone: [0, 0, 0, 0, 0, 1],
      },
    ]);
    expect(data.zombieTasks).toEqual([]);
  });
});
