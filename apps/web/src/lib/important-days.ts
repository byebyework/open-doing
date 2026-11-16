import { lunarToSolar, solarLunarYear, type LunarDate } from "./lunar";
import { daysBetween, getMonthEnd } from "./today";

/** 重要日子相对今天的方向：已过去 / 即将到来。 */
export type DayDirection = "elapsed" | "upcoming";

/** 「重要日子」相对今天的最近一次发生。 */
export interface DayOccurrence {
  direction: DayDirection;
  /** 发生日（公历 `YYYY-MM-DD`）。 */
  date: string;
  /** 距今天的天数，恒为非负；方向由 `direction` 表达（0 即「就是今天」）。 */
  days: number;
}

/** 存储层的原始规则，字段与 `important_days` 表一一对应。 */
export interface DayRule {
  date: string | null;
  isLunar: boolean;
  lunarMonth: number | null;
  lunarDay: number | null;
  repeat: "none" | "yearly";
}

/** 农历换算函数签名；测试可注入 stub 保持纯函数确定性。 */
type LunarConverter = (lunar: LunarDate) => string;

/** 公历 `year` 年 `month` 月（1-12）的天数，复用 `getMonthEnd` 的日历算术。 */
function daysInMonth(year: number, month: number): number {
  return Number(getMonthEnd(`${year}-${String(month).padStart(2, "0")}`).slice(8));
}

/**
 * 构造公历年月日；日超过当月天数时归并为当月最后一天
 * （如平年的 2 月 29 归并为 2 月 28）。
 */
function buildUtcDate(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, "0");
  const clampedDay = Math.min(day, daysInMonth(year, month));

  return `${year}-${monthText}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * 从按时间递增的候选日中取「≥ today 的最近者」。
 *
 * 两个候选都早于 today 时回退到最后一个：跨年重复场景下，
 * 下一年的候选必然 ≥ today，回退仅用于兜底。
 */
function nearestOnOrAfter(today: string, candidates: string[]): string {
  return (
    candidates.find((candidate) => daysBetween(today, candidate) >= 0) ??
    candidates[candidates.length - 1]!
  );
}

/**
 * 解析「重要日子」规则相对 `today` 的最近一次发生。
 *
 * - `repeat="none"`：直接比较锚点日，过去即 `elapsed`（days 为正），未来即 `upcoming`。
 * - `repeat="yearly"`（公历）：候选为本年与次年的 (month, day)，2 月 29 在平年归并为 2 月 28，
 *   取 ≥ today 的最近候选。
 * - `repeat="yearly"`（农历）：候选农历年为 `today` 所属农历年与次年（不是公历年号，
 *   公历 1 月往往仍属上一个农历年），各自经 `convertLunar` 换算后取 ≥ today 的最近候选。
 *
 * `convertLunar` 默认 `lunarToSolar`；测试注入 stub 以脱离真实农历库。
 */
export function resolveOccurrence(
  rule: DayRule,
  today: string,
  convertLunar: LunarConverter = lunarToSolar,
): DayOccurrence {
  if (rule.repeat === "none") {
    const date = rule.date;
    if (date === null) {
      throw new Error("resolveOccurrence: date is required for non-repeating rules");
    }

    const diff = daysBetween(today, date);

    return diff >= 0
      ? { direction: "upcoming", date, days: diff }
      : { direction: "elapsed", date, days: -diff };
  }

  if (rule.isLunar) {
    const lunarMonth = rule.lunarMonth;
    const lunarDay = rule.lunarDay;
    if (lunarMonth === null || lunarDay === null) {
      throw new Error("resolveOccurrence: lunar month and day are required for lunar rules");
    }

    const lunarYear = solarLunarYear(today);
    const candidates = [lunarYear, lunarYear + 1].map((year) =>
      convertLunar({ year, month: lunarMonth, day: lunarDay }),
    );
    const occurrence = nearestOnOrAfter(today, candidates);

    return {
      direction: "upcoming",
      date: occurrence,
      days: daysBetween(today, occurrence),
    };
  }

  const anchor = rule.date;
  if (anchor === null) {
    throw new Error("resolveOccurrence: date is required for solar rules");
  }

  const [, month, day] = anchor.split("-").map(Number);
  const todayYear = Number(today.slice(0, 4));
  const candidates = [todayYear, todayYear + 1].map((year) =>
    buildUtcDate(year, month!, day!),
  );
  const occurrence = nearestOnOrAfter(today, candidates);

  return {
    direction: "upcoming",
    date: occurrence,
    days: daysBetween(today, occurrence),
  };
}
