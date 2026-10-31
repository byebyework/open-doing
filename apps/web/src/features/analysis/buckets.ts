import { addDays } from "@open-doing/types";

import { daysBetween, getWeekStart } from "@/lib/today";

/** 分析页支持的时间范围（天）。 */
export type AnalysisRange = 7 | 30 | 90;

/** URL 参数不合法时的兜底范围。 */
const DEFAULT_RANGE: AnalysisRange = 30;

/** 分析桶：闭区间 `[start, end]` 的日历日集合，日期均为 `YYYY-MM-DD`。 */
export interface TrendBucket {
  /** 桶起点日期的 `MM-DD` 短标签。 */
  label: string;
  start: string;
  end: string;
}

/**
 * 解析分析页范围参数，只接受字面量 `"7"` / `"30"` / `"90"`。
 *
 * `undefined`、带空格或其他任何值一律回落 30；数组（重复 query 参数）
 * 不读取任何元素，直接回落 30——不依赖 `Number()` 的隐式转换
 * （`"30 "` 会被转成 30）。
 */
export function parseAnalysisRange(
  param: string | string[] | undefined,
): AnalysisRange {
  const raw = Array.isArray(param) ? undefined : param;

  if (raw === "7") {
    return 7;
  }
  if (raw === "30") {
    return 30;
  }
  if (raw === "90") {
    return 90;
  }

  return DEFAULT_RANGE;
}

/**
 * 分析范围的闭区间窗口：`[today - (range - 1), today]`。
 *
 * 入参 `today` 已是上海时区的 `YYYY-MM-DD` 日历日，直接复用
 * `addDays` 做 UTC 毫秒日历算术，不引入系统时区依赖。
 */
export function rangeWindow(
  today: string,
  range: AnalysisRange,
): { start: string; end: string } {
  return { start: addDays(today, -(range - 1)), end: today };
}

/**
 * 生成逐日桶：`[start, end]` 每天一桶，`start === end`。
 */
function dailyBuckets(start: string, end: string): TrendBucket[] {
  const buckets: TrendBucket[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    buckets.push({ label: toBucketLabel(cursor), start: cursor, end: cursor });
  }

  return buckets;
}

/** `YYYY-MM-DD` → `MM-DD` 短标签。 */
function toBucketLabel(start: string): string {
  return start.slice(5);
}

/**
 * 生成周桶：从 `firstStart`（应为周一）起每 7 天一桶，直到 `today`。
 *
 * 桶数 = `floor(daysBetween(firstStart, today) / 7) + 1`；
 * 末桶 `end` 截到 `today`，中间桶 `end = start + 6`。
 */
function weeklyBuckets(firstStart: string, today: string): TrendBucket[] {
  const count = Math.floor(daysBetween(firstStart, today) / 7) + 1;
  const buckets: TrendBucket[] = [];

  for (let i = 0; i < count; i++) {
    const start = addDays(firstStart, i * 7);
    const end = addDays(start, 6);

    buckets.push({
      label: toBucketLabel(start),
      start,
      end: end > today ? today : end,
    });
  }

  return buckets;
}

/**
 * 趋势分桶：7 / 30 天逐日一桶；90 天按 7 天周桶，首桶对齐到
 * 窗口起点所在自然周的周一（可能早于窗口起点），末桶 `end` 截到今天。
 */
export function trendBuckets(today: string, range: AnalysisRange): TrendBucket[] {
  const { start } = rangeWindow(today, range);

  if (range === 90) {
    return weeklyBuckets(getWeekStart(start), today);
  }

  return dailyBuckets(start, today);
}

/**
 * 未来到期分桶：今天起 14 个逐日桶，`[today, today + 13]`。
 */
export function futureDueBuckets(today: string): TrendBucket[] {
  return dailyBuckets(today, addDays(today, 13));
}

/**
 * 最近 `count` 个自然周桶（用于项目健康度「近 6 周」）。
 *
 * 末桶为本自然周（`getWeekStart(today)` 起 7 天），向前逐周推；
 * 不截断到今天——当前周的 `end` 可能落在未来。
 */
export function recentWeekBuckets(today: string, count: number): TrendBucket[] {
  const lastStart = getWeekStart(today);
  const buckets: TrendBucket[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(lastStart, -i * 7);

    buckets.push({
      label: toBucketLabel(start),
      start,
      end: addDays(start, 6),
    });
  }

  return buckets;
}

/**
 * 返回 `day` 落入的桶下标（`start <= day <= end`），未命中返回 -1。
 *
 * 桶数量有限，线性查找即可；字符串比较即日期序。
 */
export function bucketIndexForDay(buckets: TrendBucket[], day: string): number {
  return buckets.findIndex(
    (bucket) => day >= bucket.start && day <= bucket.end,
  );
}

/**
 * 把时间点按 Asia/Shanghai 时区折算为 `YYYY-MM-DD` 日历日。
 *
 * 沿 `todayInShanghai` 的实现手法：`en-CA` locale 的日期格式恰为 ISO 日期，
 * 显式指定时区，保证任意 TZ 下得到一致的口径。
 */
export function shanghaiDay(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(value);
}
