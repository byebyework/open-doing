import { daysBetween } from "./today";

/** 时刻的三种计时模式：正计时 / 倒计时 / 周期计时。 */
export type MomentMode = "count_up" | "countdown" | "periodic";

/** 周期计时的重复周期。 */
export type MomentCycle = "daily" | "weekly" | "monthly" | "yearly";

/** 发生日相对「今天」的方向。 */
export type MomentDirection = "elapsed" | "upcoming" | "today";

/** 一次发生日推导的结果：方向、发生日与相距天数（恒 ≥ 0）。 */
export interface MomentOccurrence {
  direction: MomentDirection;
  date: string;
  days: number;
}

/** 推导发生日所需的规则字段（与 `moments` 表的一行解耦，便于纯函数测试）。 */
export interface MomentRule {
  mode: MomentMode;
  anchorDate: string;
  cycle: MomentCycle | null;
  weekday: number | null;
  dayOfMonth: number | null;
}

const MILLIS_PER_DAY = 86_400_000;

/** 把 `YYYY-MM-DD` 按 UTC 毫秒解析为时间戳（与 `lib/today` 同口径的日历算术基准）。 */
function parseUtcDate(date: string): number {
  const [year, month, day] = date.split("-").map(Number);

  return Date.UTC(year!, month! - 1, day ?? 1);
}

/** 把 UTC 毫秒时间戳格式化为 `YYYY-MM-DD` 日历日。 */
function formatUtcDate(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** 在日历日上加减天数（UTC 毫秒算术，避开系统时区与夏令时）。 */
function addDays(date: string, days: number): string {
  return formatUtcDate(parseUtcDate(date) + days * MILLIS_PER_DAY);
}

/** 该年是否闰年（月日钳制只需判断 2 月是否有 29 日）。 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 某月的「发生日」：把目标日钳到该月月末。
 *
 * `monthIndex` 为 0 基月份；短月（如 4 月）取 30 日，2 月按闰年取 28/29 日。
 */
function clampedDateInMonth(year: number, monthIndex: number, dayOfMonth: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 1) - MILLIS_PER_DAY).getUTCDate();
  const clamped = Math.min(dayOfMonth, lastDay);

  return formatUtcDate(Date.UTC(year, monthIndex, clamped));
}

/** 计算下一次（或当天）周几对应的日历日；0 表示今天。 */
function resolveWeekly(weekday: number, today: string): string {
  const todayWeekday = new Date(parseUtcDate(today)).getUTCDay();
  const diff = (weekday - todayWeekday + 7) % 7;

  return addDays(today, diff);
}

/**
 * 计算本月（已过则下月）的每月发生日。
 *
 * 先把 dayOfMonth 钳到本月月末；若钳制后的日期早于今天，则对下月重新钳制。
 */
function resolveMonthly(dayOfMonth: number, today: string): string {
  const [year, month] = today.split("-").map(Number);
  const current = clampedDateInMonth(year!, month! - 1, dayOfMonth);

  if (current >= today) return current;

  // 传入 1 基月份恰好等于下月的 0 基索引；12 月会自然进位到下一年。
  return clampedDateInMonth(year!, month!, dayOfMonth);
}

/**
 * 计算今年（已过则明年）的周年发生日。
 *
 * 月日取自锚点日；2 月 29 日在非闰年归并为 2 月 28 日。
 */
function resolveYearly(anchorDate: string, today: string): string {
  const [, month, day] = anchorDate.split("-").map(Number);
  const todayYear = Number(today.slice(0, 4));

  for (let year = todayYear; year <= todayYear + 1; year += 1) {
    const safeDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day!;
    const candidate = formatUtcDate(Date.UTC(year, month! - 1, safeDay));

    if (candidate >= today) return candidate;
  }

  // 循环必然在前两个候选之一命中，此处仅作类型收尾。
  return today;
}

/** 周期模式：按周期算出下次发生日，再与今天求方向。 */
function resolvePeriodic(rule: MomentRule, today: string): MomentOccurrence {
  let date = today;

  switch (rule.cycle) {
    case "daily":
      date = today;
      break;
    case "weekly":
      date = resolveWeekly(rule.weekday ?? 0, today);
      break;
    case "monthly":
      date = resolveMonthly(rule.dayOfMonth ?? 1, today);
      break;
    case "yearly":
      date = resolveYearly(rule.anchorDate, today);
      break;
  }

  const days = daysBetween(today, date);

  return { direction: days === 0 ? "today" : "upcoming", date, days };
}

/**
 * 推导某个时刻在 `today` 当天的发生日与方向。
 *
 * - 正计时：从锚点日起累计天数；未来锚点（service 层应拒绝）钳制为今天/0。
 * - 倒计时：目标日已过即为正计时方向（elapsed），天数恒为正。
 * - 周期：每日恒今天；每周取下一次目标周几；每月把目标日钳到月末；
 *   每年取今年周年，2/29 在非闰年归并 2/28。
 *
 * 全部为 UTC 毫秒日历算术，输出与 `lib/today` 的 `YYYY-MM-DD` 口径一致。
 */
export function resolveOccurrence(rule: MomentRule, today: string): MomentOccurrence {
  switch (rule.mode) {
    case "count_up": {
      const days = Math.max(0, daysBetween(rule.anchorDate, today));

      return days === 0
        ? { direction: "today", date: today, days: 0 }
        : { direction: "elapsed", date: rule.anchorDate, days };
    }
    case "countdown": {
      const diff = daysBetween(today, rule.anchorDate);

      if (diff > 0) return { direction: "upcoming", date: rule.anchorDate, days: diff };
      if (diff === 0) return { direction: "today", date: today, days: 0 };

      return { direction: "elapsed", date: rule.anchorDate, days: -diff };
    }
    case "periodic":
      return resolvePeriodic(rule, today);
  }
}
