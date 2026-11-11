/**
 * 全站日期显示口径（spec D10/D11）：
 *
 * - 任务日期一律显示完整 `YYYY-MM-DD`，不再有 `MM-DD` 短格式或「今天 / 明天」
 *   相对文案（日历的「今天」按钮 / 今日徽标、统计卡文案、通知模板除外——
 *   它们是导航或语义化文案，不是日期展示）。
 * - 时间戳一律显示 `YYYY-MM-DD HH:mm`，按 Asia/Shanghai 归属日历日。
 */

const PERSONAL_TIME_ZONE = "Asia/Shanghai";

/** 任务日期原样返回。存储格式即展示格式；畸形输入显示原文，不抛错。 */
export function formatTaskDate(date: string): string {
  return date;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PERSONAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 把绝对时刻格式化为 Asia/Shanghai 口径的 `YYYY-MM-DD HH:mm`。
 *
 * en-CA 输出形如 `2026-10-22, 10:30`，去掉日期与时间之间的逗号。
 * 空值 / 畸形值显示原文（与 formatTaskDate 同样的容错策略）。
 */
export function formatTaskTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return TIMESTAMP_FORMATTER.format(value).replace(", ", " ");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return TIMESTAMP_FORMATTER.format(parsed).replace(", ", " ");
}
