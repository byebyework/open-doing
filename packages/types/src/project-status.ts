/** 项目状态三态：由进度推导（0 → 未开始，>=1 → 已完成，其余 → 进行中）。 */
export type ProjectStatusKind = "not_started" | "in_progress" | "completed";

/**
 * 把项目进度（0–1，来自 `ProjectStats.progress`）映射为展示状态。
 *
 * 口径与「进度自任务自动聚合」一致：不引入存储状态字段，避免状态与进度打架。
 */
export function getProjectStatusKind(progress: number): ProjectStatusKind {
  if (progress <= 0) return "not_started";
  if (progress >= 1) return "completed";
  return "in_progress";
}
