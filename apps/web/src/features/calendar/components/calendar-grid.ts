import { getMonthGrid } from "@/lib/today";

/**
 * 日历月网格的纯函数层（antd Calendar → react-day-picker 换装）。
 *
 * 键一律是 `YYYY-MM-DD` 日历日字符串；`Date` 锚点用本地字段构造器
 * （`new Date(y, m, d)`）生成，**不使用 `new Date("YYYY-MM-DD")` 的 UTC
 * 解析**，格式化走本地 `getFullYear/getMonth/getDate`——因此「今天」
 * 高亮与落格映射不随运行时时区漂移（对照 `lib/today.ts` 的 UTC 口径）。
 */

/** `YYYY-MM` → 本地月初锚点 `Date`（react-day-picker 的受控 `month`）。 */
export function monthAnchor(month: string): Date {
  const [year, monthIndex] = month.split("-").map(Number);

  return new Date(year!, monthIndex! - 1, 1);
}

/** 本地 `Date` → `YYYY-MM-DD` 日历日键（本地字段，不经 UTC 换算）。 */
export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * `YYYY-MM` → 固定 42 格（6 周）网格的日期键，周一起、
 * 首尾以相邻月份日期补齐（与 `lib/today.ts#getMonthGrid` 同口径）。
 */
export function gridDateKeys(month: string): string[] {
  const { start } = getMonthGrid(month);

  return Array.from({ length: 42 }, (_, index) =>
    addDaysKey(start, index),
  );
}

/** 按任务的 `dueDate` 把任务分进日期桶（保持输入顺序）；无截止日期不落格。 */
export function indexTasksByDate<T extends { id: string; dueDate: string }>(
  tasks: T[],
): Map<string, T[]> {
  const byDate = new Map<string, T[]>();

  for (const task of tasks) {
    const bucket = byDate.get(task.dueDate);

    if (bucket) {
      bucket.push(task);
    } else {
      byDate.set(task.dueDate, [task]);
    }
  }

  return byDate;
}

/** `YYYY-MM` 加减月份数（跨年自然进位），翻月按钮用。 */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const total = year! * 12 + (monthIndex! - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonthIndex = (total % 12) + 1;

  return `${nextYear}-${String(nextMonthIndex).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` 加减天数（与 `lib/today` 同口径的 UTC 毫秒日历算术）。 */
function addDaysKey(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year!, month! - 1, day!) + days * 86_400_000,
  );
  const monthKey = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dayKey = String(shifted.getUTCDate()).padStart(2, "0");

  return `${shifted.getUTCFullYear()}-${monthKey}-${dayKey}`;
}
