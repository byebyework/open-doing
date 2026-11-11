/**
 * 项目列表卡片的聚合统计与健康徽标判定(空间级「项目」模块)。
 *
 * 口径约定(设计文档 2026-11-11-projects-module-design.md):
 * - `progress` 为项目内各任务进度的等权平均(空项目 0);
 * - 健康徽标优先级:已逾期 > 临期 > 未开始 > 正常——0% 但有逾期任务的项目
 *   必须显示「已逾期」,风险信息优先于进度信息。
 */

/** 单个项目的聚合统计(可跨 RSC 边界序列化)。 */
export interface ProjectStats {
  /** 任务进度等权平均(0~1);空项目为 0。 */
  progress: number;
  /** 全部任务数(含已完成)。 */
  taskCount: number;
  /** 已完成任务数。 */
  doneCount: number;
  /** 未完成且逾期的任务数。 */
  overdueCount: number;
  /** 未完成且临期(今天或明天截止)的任务数。 */
  dueSoonCount: number;
}

/** 项目健康徽标四态。 */
export type ProjectHealthKind = "overdue" | "dueSoon" | "notStarted" | "normal";

/**
 * 健康徽标判定。优先级:已逾期 > 临期 > 未开始 > 正常。
 */
export function getProjectHealthKind(stats: ProjectStats): ProjectHealthKind {
  if (stats.overdueCount > 0) return "overdue";
  if (stats.dueSoonCount > 0) return "dueSoon";
  if (stats.progress === 0) return "notStarted";
  return "normal";
}

/**
 * 各项目进度的等权平均(0~1);空数组返回 0。
 *
 * 产品设计文档 §7 口径:团队进度 = 各团队项目进度的简单平均(每个项目
 * 等权),空项目计 0%、不被排除。注意与 team-overview 的任务级平均
 * (`avgProgress`)是两个口径,后者本轮不动。
 */
export function averageProjectProgress(projectProgresses: number[]): number {
  if (projectProgresses.length === 0) return 0;
  const total = projectProgresses.reduce((sum, p) => sum + p, 0);
  return total / projectProgresses.length;
}
