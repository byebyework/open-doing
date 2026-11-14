/**
 * 注册码余量状态（纯函数，无 React / 数据库依赖）。
 *
 * 阈值与概览卡、注册码列表共用同一口径：剩余 === 0 视为耗尽，
 * 0 < 剩余 ≤ 2 视为临近耗尽。抽到独立模块，供 `overview-cards`（RSC）
 * 与 `codes-table`（client）复用，避免两处阈值漂移。
 */
export type CodeStatus = "normal" | "exhausted" | "low";

/** 由名额与已用次数推导余量状态。 */
export function codeStatus(maxUses: number, usedCount: number): CodeStatus {
  const remaining = maxUses - usedCount;
  if (remaining <= 0) return "exhausted";
  if (remaining <= 2) return "low";

  return "normal";
}
