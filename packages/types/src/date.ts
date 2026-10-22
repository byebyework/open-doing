import type { TaskStatus } from "./index";

/**
 * 在 `YYYY-MM-DD` 日期上加减天数，返回同格式日期。
 *
 * 使用 UTC 毫秒算术完成解析与格式化（`Date.UTC` / `getUTC*`），
 * 绝不依赖本地时区，避免跨时区运行结果不一致。
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const timestamp =
    Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000;
  const result = new Date(timestamp);

  const resultYear = result.getUTCFullYear();
  const resultMonth = String(result.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(result.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

/**
 * 是否逾期：未完成且今天晚于截止日期。
 *
 * 截止日当天不算逾期，次日起算；`YYYY-MM-DD` 字符串的字典序即日期序。
 */
export function isOverdue(
  dueDate: string,
  status: TaskStatus,
  today: string,
): boolean {
  return status !== "done" && today > dueDate;
}

/**
 * 是否临期：未完成且截止日期为今天或明天。
 */
export function isDueSoon(
  dueDate: string,
  status: TaskStatus,
  today: string,
): boolean {
  return status !== "done" && (dueDate === today || dueDate === addDays(today, 1));
}
