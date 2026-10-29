import { addDays } from "@open-doing/types";

/** 个人空间统一使用的时区。 */
const PERSONAL_TIME_ZONE = "Asia/Shanghai";

/** 周日 → 周六（`Date#getUTCDay` 的索引顺序）。 */
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * 返回 Asia/Shanghai 时区下的「今天」，格式 `YYYY-MM-DD`。
 *
 * `en-CA` locale 的日期格式恰为 ISO 日期；显式指定时区，
 * 保证服务器运行在任意 TZ 下得到一致的截止日期判定基准。
 */
export function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PERSONAL_TIME_ZONE,
  }).format(new Date());
}

/**
 * 计算今天所在自然周的周一日期（Asia/Shanghai 口径）。
 *
 * 入参 `today` 已是上海时区的 `YYYY-MM-DD` 日历日，因此直接按 UTC
 * 毫秒做日历算术即可（与 `addDays` 一致），不引入系统时区依赖。
 *
 * 纯函数放在 `lib/today`（而非 service）：客户端组件需要它做「本周完成」
 * 计数，service 模块会把数据库驱动带进浏览器包。
 */
export function getWeekStart(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  // getUTCDay: 0=周日 … 6=周六；换算为「周一=0」的偏移。
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const offset = (weekday + 6) % 7;

  return addDays(today, -offset);
}

/**
 * `YYYY-MM-DD` → 「周X」（如 `2026-10-21` → `周三`）。
 *
 * 与 `getWeekStart` 同口径：把日历日按 UTC 毫秒解析，不依赖系统时区。
 */
export function weekdayLabel(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();

  return WEEKDAY_LABELS[weekday]!;
}
