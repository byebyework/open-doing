/**
 * 项目健康度着色规则（可调阈值常量）。
 *
 * 判定阈值集中在这里，后续若改为「按逾期天数分级」「临期窗口放宽到 3 天」
 * 等口径，只需调整本文件与 `resolveProjectHealthLevel`，页面无需改动：
 * - `overdue`：存在未完成且已过截止日期的任务 → error 色；
 * - `dueSoon`：否则存在未完成且今天 / 明天到期的任务 → warning 色；
 * - `normal`：其余情况 → success 色。
 *
 * 颜色取值自设计令牌（docs/prototypes/assets/design-tokens.css 中的
 * error-500 / warning-500 / success-500 及其背景色）。
 */
export const HEALTH_COLOR_RULES = {
  overdue: {
    color: "var(--status-overdue)",
    background: "var(--status-overdue-bg)",
  },
  dueSoon: {
    color: "#a66b00",
    background: "var(--status-due-soon-bg)",
  },
  normal: {
    color: "#00b894",
    background: "rgba(0, 184, 148, 0.1)",
  },
} as const;

/** 健康度标签的消息 key（`dashboard` 命名空间），语言无关，渲染时翻译。 */
export const HEALTH_LABEL_KEYS = {
  overdue: "healthOverdue",
  dueSoon: "healthDueSoon",
  normal: "healthNormal",
} as const;

/** 项目健康度级别，键与 `HEALTH_COLOR_RULES` 一致。 */
export type ProjectHealthLevel = keyof typeof HEALTH_COLOR_RULES;

/**
 * 按优先级判定项目健康度：逾期 > 临期 > 正常。
 *
 * 阈值即上方三个 `hasOverdue` / `hasDueSoon` 布尔标记，调整判定口径时
 * 一并修改 `service.ts` 中的标记计算。
 */
export function resolveProjectHealthLevel(
  hasOverdue: boolean,
  hasDueSoon: boolean,
): ProjectHealthLevel {
  if (hasOverdue) return "overdue";
  if (hasDueSoon) return "dueSoon";
  return "normal";
}
