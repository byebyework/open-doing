import { TASK_PRIORITY_ORDER, type TaskPriority } from "@open-doing/types";

/** 参与优先级排序的行形状（两个任务列表共用）。 */
export interface PrioritySortInput {
  priority: TaskPriority;
  dueDate?: string | null;
  createdAt: string;
}

const NO_DUE_DATE = "9999";

/**
 * 「按优先级（高→低）」比较函数（spec D6）：
 *
 * 优先级高在前（TASK_PRIORITY_ORDER 索引差取反）→ 同级按截止日期升序、
 * 无日期靠后 → 最终平局按创建时间升序（既有尾序）。
 */
export function compareByPriority(
  a: PrioritySortInput,
  b: PrioritySortInput,
): number {
  const byPriority =
    TASK_PRIORITY_ORDER.indexOf(b.priority) -
    TASK_PRIORITY_ORDER.indexOf(a.priority);
  if (byPriority !== 0) return byPriority;

  const aDue = a.dueDate ?? NO_DUE_DATE;
  const bDue = b.dueDate ?? NO_DUE_DATE;
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;

  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return 0;
}
