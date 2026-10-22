import type { TaskStatus } from "./index";

/**
 * 计算单个任务的进度（0 ~ 1）。
 *
 * - 有子任务：已完成子任务数 / 子任务总数
 * - 无子任务：按状态映射 todo = 0、in_progress = 0.5、done = 1
 */
export function getTaskProgress(input: {
  status: TaskStatus;
  subtasks: { completed: boolean }[];
}): number {
  if (input.subtasks.length > 0) {
    const completedCount = input.subtasks.filter(
      (subtask) => subtask.completed,
    ).length;
    return completedCount / input.subtasks.length;
  }

  switch (input.status) {
    case "done":
      return 1;
    case "in_progress":
      return 0.5;
    default:
      return 0;
  }
}

/**
 * 聚合项目进度（0 ~ 1），即各任务进度的简单平均。
 *
 * `taskCount` 为项目总任务数，调用方须保证其与 `taskProgresses` 等长；
 * 本函数仅用其判空。空数组或非正任务数一律返回 0。
 */
export function aggregateProjectProgress(
  taskProgresses: number[],
  taskCount: number,
): number {
  if (taskCount <= 0 || taskProgresses.length === 0) {
    return 0;
  }

  const total = taskProgresses.reduce((sum, progress) => sum + progress, 0);
  return total / taskProgresses.length;
}
