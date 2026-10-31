import { addDays } from "@open-doing/types";
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { projects, tasks } from "@/server/db/schema";

import {
  bucketIndexForDay,
  futureDueBuckets,
  rangeWindow,
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
        .groupBy(tasks.projectId, projects.name)
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
      doneCount: row.doneCount,
    })),
  };
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
