import { addDays, type SpaceType } from "@open-doing/types";
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";

import { getTeamOverview } from "@/features/dashboard/team-overview/service";
import { teamScope } from "@/features/kanban/service";
import { daysBetween, getWeekStart } from "@/lib/today";
import { db, type DbClient } from "@/server/db/client";
import { projects, tasks, users } from "@/server/db/schema";

import {
  bucketIndexForDay,
  futureDueBuckets,
  rangeWindow,
  recentWeekBuckets,
  shanghaiDay,
  trendBuckets,
  type AnalysisRange,
  type TrendBucket,
} from "./buckets";

/** 按时率（固定近 30 天窗口，不随 `range` 变化）。 */
export interface OnTimeStats {
  /** 分母：有截止日期且完成日在固定窗口内的 done 任务数。 */
  denominator: number;
  /** 其中完成日 ≤ 截止日的任务数。 */
  onTime: number;
  /** `Math.round(onTime / denominator * 100)`；分母为 0 时为 null。 */
  ratePercent: number | null;
}

/** 个人空间统计卡（当前快照，不随 `range` 变化）。 */
export interface PersonalAnalysisStats {
  inProgress: number;
  doneThisMonth: number;
  overdue: number;
  onTime: OnTimeStats;
}

/** 单系列趋势点（每个分桶一个点，计数可以为 0）。 */
export interface AnalysisTrendPoint {
  label: string;
  count: number;
}

/** 新增 vs 完成双系列趋势点。 */
export interface CreatedCompletedPoint {
  label: string;
  created: number;
  completed: number;
}

/** 项目对比行：范围内完成的任务按项目聚合。 */
export interface ProjectComparisonRow {
  projectId: string | null;
  /** 无项目任务为空字符串。 */
  projectName: string;
  /** 任务所属空间：个人项目为 personal，团队项目（含无项目的团队任务）为 team。 */
  spaceType: SpaceType;
  doneCount: number;
}

/** 个人空间 Analysis 一次取数的全部数据（DTO 可序列化）。 */
export interface PersonalSpaceAnalysis {
  stats: PersonalAnalysisStats;
  completionTrend: AnalysisTrendPoint[];
  createdVsCompleted: CreatedCompletedPoint[];
  futureDue: AnalysisTrendPoint[];
  projectComparison: ProjectComparisonRow[];
}

/** 僵尸任务行：长时间停留在 `in_progress` 的团队任务。 */
export interface ZombieTaskItem {
  id: string;
  title: string;
  projectName: string;
  /** 责任人用户名；未指派时为 null。 */
  assigneeName: string | null;
  /** 距最后更新（上海日）的天数，僵尸至少 15 天。 */
  stalledDays: number;
}

/** 团队空间统计卡（当前快照，不随 `range` 变化）。 */
export interface TeamAnalysisStats {
  projectCount: number;
  /** `Math.round(avgProgress * 100)`，即团队整体进度百分比。 */
  avgProgressPercent: number;
  overdue: number;
  doneThisWeek: number;
}

/** 项目健康度行：快照 + 近 6 周完成分桶。 */
export interface ProjectHealthRow {
  projectId: string;
  projectName: string;
  progressPercent: number;
  hasOverdue: boolean;
  hasDueSoon: boolean;
  taskCount: number;
  /** 该项目全部已完成任务数（不限 6 周窗口）。 */
  doneTotal: number;
  /** 近 6 周内完成的团队任务数（与 `weeklyDone` 同窗口）。 */
  doneCount: number;
  /** 恒长 6，对应 `recentWeekBuckets(today, 6)`，末桶为本自然周。 */
  weeklyDone: number[];
}

/** 团队成员负载行（从团队概览快照裁剪，丢弃任务列表）。 */
export interface TeamMemberLoadRow {
  userId: string;
  username: string;
  /** 展示名候选：UI 侧用 `displayName(member)` 解析（username 仅用于登录）。 */
  nickname: string | null;
  inProgress: number;
  dueSoon: number;
  overdue: number;
}

/** 团队空间 Analysis 一次取数的全部数据（DTO 可序列化）。 */
export interface TeamSpaceAnalysis {
  stats: TeamAnalysisStats;
  throughput: AnalysisTrendPoint[];
  members: TeamMemberLoadRow[];
  /** 未指派且未完成的团队任务数（`getTeamOverview.unassigned` 同口径）。 */
  unassignedCount: number;
  projectHealth: ProjectHealthRow[];
  zombieTasks: ZombieTaskItem[];
}

/**
 * 上海日历日文本：`timestamptz → 上海本地日期 → YYYY-MM-DD`。
 *
 * 完成日 = `updated_at` 的上海日历日（M3 代理口径，与 Calendar / 通知同源）；
 * 显式 `AT TIME ZONE 'Asia/Shanghai'`，不跟随数据库会话时区。SQL 侧先物化成
 * 日期字符串再进 TS 分桶，避免 JS `Date` 的时区漂移。
 */
const completedDay = sql<string>`(${tasks.updatedAt} AT TIME ZONE 'Asia/Shanghai')::date::text`;

/** 创建日的上海日历日文本，口径同 `completedDay`。 */
const createdDay = sql<string>`(${tasks.createdAt} AT TIME ZONE 'Asia/Shanghai')::date::text`;

/** 单条 `count(*) FILTER` 聚合的原始行。 */
interface StatsRow {
  inProgress: number;
  doneThisMonth: number;
  overdue: number;
  onTimeDenominator: number;
  onTimeCount: number;
}

/**
 * 个人空间 Analysis 聚合。
 *
 * 范围谓词恒为 `assigneeId = userId`（个人任务 + 指派给我的团队任务，与
 * `getMyTaskStats` / Dashboard 同口径；**不是** kanban `personalScope`）。
 * `userId` 由调用方从会话取得，本函数不做权限判断。
 *
 * 口径固定如下：
 * - `stats` 为当前快照，不随 `range` 变化；按时率用**固定近 30 天**窗口
 *   `[today - 29, today]`，分母只含有截止日期的 done 任务。
 * - `completionTrend` / `createdVsCompleted` / `projectComparison` 只看
 *   `rangeWindow(range)` 窗口；`futureDue` 固定 14 天。
 * - 完成日 / 创建日均为上海日历日（`updated_at` / `created_at` 的代理口径）。
 *
 * 五组查询并行执行；趋势桶由 TS 侧按 `bucketIndexForDay` 落桶，桶序天然固定。
 */
export async function getPersonalSpaceAnalysis(
  userId: string,
  range: AnalysisRange,
  today: string,
  client: DbClient = db,
): Promise<PersonalSpaceAnalysis> {
  const window = rangeWindow(today, range);
  const onTimeStart = addDays(today, -29);
  const monthStart = `${today.slice(0, 7)}-01`;
  const futureEnd = addDays(today, 13);

  const [statsRow, createdRows, completedRows, futureRows, projectRows] =
    await Promise.all([
      selectStats(client, userId, today, monthStart, onTimeStart),
      client
        .select({ createdDay })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeId, userId),
            sql`${createdDay} >= ${window.start}`,
            sql`${createdDay} <= ${window.end}`,
          ),
        ),
      client
        .select({ completedDay })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeId, userId),
            eq(tasks.status, "done"),
            sql`${completedDay} >= ${window.start}`,
            sql`${completedDay} <= ${window.end}`,
          ),
        ),
      client
        .select({ dueDate: tasks.dueDate })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeId, userId),
            ne(tasks.status, "done"),
            gte(tasks.dueDate, today),
            lte(tasks.dueDate, futureEnd),
          ),
        ),
      client
        .select({
          projectId: tasks.projectId,
          projectName: projects.name,
          spaceType: tasks.spaceType,
          doneCount: sql<number>`count(*)::int`,
        })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(tasks.assigneeId, userId),
            eq(tasks.status, "done"),
            sql`${completedDay} >= ${window.start}`,
            sql`${completedDay} <= ${window.end}`,
          ),
        )
        .groupBy(tasks.projectId, projects.name, tasks.spaceType)
        .orderBy(
          desc(sql`count(*)`),
          // doneCount 平局时按项目名升序；无项目任务用空串参与排序。
          asc(sql`coalesce(${projects.name}, '')`),
        ),
    ]);

  return {
    stats: toStats(statsRow),
    completionTrend: toCompletionTrend(today, range, completedRows),
    createdVsCompleted: toCreatedVsCompleted(
      today,
      range,
      createdRows,
      completedRows,
    ),
    futureDue: toFutureDue(today, futureRows),
    projectComparison: projectRows.map((row) => ({
      projectId: row.projectId ?? null,
      projectName: row.projectName ?? "",
      spaceType: row.spaceType,
      doneCount: row.doneCount,
    })),
  };
}

/**
 * 团队空间 Analysis 聚合（M5）。
 *
 * **权限前置条件**：调用方（团队 Analysis 页面）必须先校验团队存在且当前
 * 用户是成员（非成员 / 不存在一律 404）；本函数只按 `teamId` 聚合，不做
 * 成员判断，因此不能直接暴露为公开 API。
 *
 * 口径如下：
 * - 范围恒为 `teamScope(teamId)`（`space_type = 'team'` + 任务所属项目属于该
 *   团队），未指派任务天然纳入；与 Kanban / Calendar 团队口径一致。
 * - `stats` / `members` / `projectHealth` 的基础字段来自 `getTeamOverview`
 *   的当前快照（不随 `range` 变化）；`doneThisWeek` 以 `updatedAt` 归入
 *   今天所在自然周（周一为起点，上海时区）。
 * - `throughput` 只统计 `rangeWindow(range)` 内完成的团队任务，完成日为
 *   `updated_at` 的上海日历日（M3 代理口径）；分桶与个人完成趋势同法。
 * - `projectHealth.weeklyDone` / `doneCount` 固定近 6 个自然周，末桶为本
 *   周；`doneTotal` 为项目全部已完成数（不限窗口）；不足 6 项补 0。
 * - `unassignedCount` 直接取 `getTeamOverview.unassigned.length`（未指派且
 *   未完成），不新增查询。
 * - `zombieTasks`：`in_progress` 且 `updated_at` 早于 **today-14 上海零点**
 *   （恰为 today-14 当天任意时刻不算僵尸），按最后更新升序取前 10；
 *   `stalledDays` 按上海日计算，僵尸因此恒 ≥ 15。
 *
 * 已知边界（§M5 数据口径）：完成日以 `updated_at` 近似，删除任务后无法
 * 重建其历史完成记录，趋势会随之失真——本函数不回填已删除任务。
 *
 * 五组查询并行执行：快照 + 本周完成计数 + 吞吐 + 近 6 周完成明细 + 僵尸任务。
 */
export async function getTeamSpaceAnalysis(
  input: {
    teamId: string;
    teamSlug: string;
    range: AnalysisRange;
    today: string;
  },
  client: DbClient = db,
): Promise<TeamSpaceAnalysis> {
  const { teamId, teamSlug, range, today } = input;
  const window = rangeWindow(today, range);
  const weekStart = getWeekStart(today);
  const weekBuckets = recentWeekBuckets(today, 6);
  const zombieCutoff = addDays(today, -14);
  const scope = teamScope(teamId);

  const [
    overview,
    doneThisWeekRows,
    throughputRows,
    projectDoneRows,
    zombieRows,
  ] = await Promise.all([
    getTeamOverview({ teamId, teamSlug, today }, client),
    client
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          scope,
          eq(tasks.status, "done"),
          // `weekStart` 是上海本地日历日，显式换算为 timestamptz，
          // 不跟随数据库会话时区（沿 `getMyTaskStats` 的注释口径）。
          sql`${tasks.updatedAt} >= (${weekStart}::timestamp AT TIME ZONE 'Asia/Shanghai')`,
        ),
      ),
    client
      .select({ completedDay })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          scope,
          eq(tasks.status, "done"),
          sql`${completedDay} >= ${window.start}`,
          sql`${completedDay} <= ${window.end}`,
        ),
      ),
    client
      .select({ projectId: tasks.projectId, completedDay })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(scope, eq(tasks.status, "done"))),
    client
      .select({
        id: tasks.id,
        title: tasks.title,
        projectName: projects.name,
        assigneeUsername: users.username,
        assigneeNickname: users.name,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(
        and(
          scope,
          eq(tasks.status, "in_progress"),
          sql`${tasks.updatedAt} < (${zombieCutoff}::timestamp AT TIME ZONE 'Asia/Shanghai')`,
        ),
      )
      .orderBy(asc(tasks.updatedAt))
      .limit(10),
  ]);

  const projectAggregates = aggregateProjectDone(projectDoneRows, weekBuckets);

  return {
    stats: {
      projectCount: overview.teamStats.projectCount,
      avgProgressPercent: Math.round(overview.teamStats.avgProgress * 100),
      overdue: overview.teamStats.overdueCount,
      doneThisWeek: doneThisWeekRows[0]?.count ?? 0,
    },
    throughput: toThroughput(today, range, throughputRows),
    members: overview.members.map(
      ({ userId, username, nickname, inProgress, dueSoon, overdue }) => ({
        userId,
        username,
        nickname,
        inProgress,
        dueSoon,
        overdue,
      }),
    ),
    unassignedCount: overview.unassigned.length,
    projectHealth: overview.projects.map((project) => {
      const aggregate = projectAggregates.get(project.projectId);

      return {
        projectId: project.projectId,
        projectName: project.projectName,
        progressPercent: Math.round(project.progress * 100),
        hasOverdue: project.hasOverdue,
        hasDueSoon: project.hasDueSoon,
        taskCount: project.taskCount,
        doneTotal: aggregate?.doneTotal ?? 0,
        doneCount: aggregate?.doneCount ?? 0,
        weeklyDone: aggregate
          ? [...aggregate.weeklyDone]
          : new Array<number>(weekBuckets.length).fill(0),
      };
    }),
    zombieTasks: zombieRows.map((row) => ({
      id: row.id,
      title: row.title,
      projectName: row.projectName,
      // 展示名：昵称优先，未填写回退到用户名。
      assigneeName: row.assigneeNickname ?? row.assigneeUsername ?? null,
      // 按上海日历日计算停留天数：跨 UTC 日边界的更新不会多算一天。
      stalledDays: daysBetween(shanghaiDay(row.updatedAt), today),
    })),
  };
}

/**
 * 项目完成聚合：全部 done 明细 → 每项目全部完成数 + 近 6 周完成数与周分桶。
 *
 * `doneTotal` 计全部已完成；`doneCount` / `weeklyDone` 只计 6 周窗口内，
 * 窗口外明细在 `bucketIndexForDay` 返回 -1 时被丢弃。
 */
function aggregateProjectDone(
  rows: { projectId: string | null; completedDay: string }[],
  weekBuckets: TrendBucket[],
): Map<string, { doneTotal: number; doneCount: number; weeklyDone: number[] }> {
  const aggregates = new Map<
    string,
    { doneTotal: number; doneCount: number; weeklyDone: number[] }
  >();

  for (const row of rows) {
    if (!row.projectId) {
      continue;
    }

    let aggregate = aggregates.get(row.projectId);
    if (!aggregate) {
      aggregate = {
        doneTotal: 0,
        doneCount: 0,
        weeklyDone: new Array<number>(weekBuckets.length).fill(0),
      };
      aggregates.set(row.projectId, aggregate);
    }

    aggregate.doneTotal += 1;
    const index = bucketIndexForDay(weekBuckets, row.completedDay);
    if (index >= 0) {
      aggregate.doneCount += 1;
      aggregate.weeklyDone[index]! += 1;
    }
  }

  return aggregates;
}

/** 吞吐趋势：与个人完成趋势同口径，复用同一分桶实现。 */
function toThroughput(
  today: string,
  range: AnalysisRange,
  rows: { completedDay: string }[],
): AnalysisTrendPoint[] {
  return toCompletionTrend(today, range, rows);
}

/**
 * 统计卡：一条 `count(*) FILTER (WHERE ...)` 聚合（沿 `getMyTaskStats` 写法）。
 *
 * - `doneThisMonth`：done 且上海完成日 ≥ 本月 1 日；
 * - `overdue`：未完成且截止日早于今天（当天不算逾期）；
 * - 按时率分母：done + 有截止日期 + 完成日 ∈ `[today - 29, today]`；
 *   分子额外要求完成日 ≤ 截止日。
 */
async function selectStats(
  client: DbClient,
  userId: string,
  today: string,
  monthStart: string,
  onTimeStart: string,
): Promise<StatsRow | undefined> {
  const [row] = await client
    .select({
      inProgress: sql<number>`(count(*) filter (where ${tasks.status} = 'in_progress'))::int`,
      doneThisMonth: sql<number>`(count(*) filter (where ${tasks.status} = 'done' and ${completedDay} >= ${monthStart}))::int`,
      overdue: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}::date))::int`,
      onTimeDenominator: sql<number>`(count(*) filter (where ${tasks.status} = 'done' and ${tasks.dueDate} is not null and ${completedDay} >= ${onTimeStart} and ${completedDay} <= ${today}))::int`,
      onTimeCount: sql<number>`(count(*) filter (where ${tasks.status} = 'done' and ${tasks.dueDate} is not null and ${completedDay} >= ${onTimeStart} and ${completedDay} <= ${today} and ${completedDay} <= ${tasks.dueDate}::text))::int`,
    })
    .from(tasks)
    .where(eq(tasks.assigneeId, userId));

  return row;
}

/** 聚合原始行 → 统计卡 DTO；分母 0 时 `ratePercent` 为 null（渲染「—」）。 */
function toStats(row: StatsRow | undefined): PersonalAnalysisStats {
  const denominator = row?.onTimeDenominator ?? 0;
  const onTime = row?.onTimeCount ?? 0;

  return {
    inProgress: row?.inProgress ?? 0,
    doneThisMonth: row?.doneThisMonth ?? 0,
    overdue: row?.overdue ?? 0,
    onTime: {
      denominator,
      onTime,
      ratePercent:
        denominator === 0 ? null : Math.round((onTime / denominator) * 100),
    },
  };
}

/** 按桶计数：`day` 落入的桶 +1，窗口外（-1）忽略。 */
function countIntoBuckets(
  buckets: TrendBucket[],
  days: Iterable<string>,
): number[] {
  const counts = new Array<number>(buckets.length).fill(0);

  for (const day of days) {
    const index = bucketIndexForDay(buckets, day);
    if (index >= 0) {
      counts[index]! += 1;
    }
  }

  return counts;
}

/** 完成趋势：done 且完成日 ∈ range 窗口，每个桶一个点（含 0）。 */
function toCompletionTrend(
  today: string,
  range: AnalysisRange,
  rows: { completedDay: string }[],
): AnalysisTrendPoint[] {
  const buckets = trendBuckets(today, range);
  const counts = countIntoBuckets(
    buckets,
    rows.map((row) => row.completedDay),
  );

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    count: counts[index]!,
  }));
}

/** 新增 vs 完成：同窗口内按 createdDay / completedDay 各自落桶。 */
function toCreatedVsCompleted(
  today: string,
  range: AnalysisRange,
  createdRows: { createdDay: string }[],
  completedRows: { completedDay: string }[],
): CreatedCompletedPoint[] {
  const buckets = trendBuckets(today, range);
  const createdCounts = countIntoBuckets(
    buckets,
    createdRows.map((row) => row.createdDay),
  );
  const completedCounts = countIntoBuckets(
    buckets,
    completedRows.map((row) => row.completedDay),
  );

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    created: createdCounts[index]!,
    completed: completedCounts[index]!,
  }));
}

/** 未来 14 天到期分布：未完成且 `dueDate ∈ [today, today + 13]`。 */
function toFutureDue(
  today: string,
  rows: { dueDate: string | null }[],
): AnalysisTrendPoint[] {
  const buckets = futureDueBuckets(today);
  const counts = countIntoBuckets(
    buckets,
    rows.flatMap((row) => (row.dueDate ? [row.dueDate] : [])),
  );

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    count: counts[index]!,
  }));
}
