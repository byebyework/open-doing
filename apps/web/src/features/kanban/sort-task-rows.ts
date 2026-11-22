import type { TaskPriority } from "@open-doing/types";
import { TASK_PRIORITY_ORDER } from "@open-doing/types";

/** 无截止日期的任务排在最后。 */
const NO_DUE_DATE = "9999-12-31";

/**
 * 任务列表默认排序：截止日期升序、null 最后；同日期按优先级高 > 中 > 低；
 * 其余平局保持输入顺序（Array.prototype.sort 稳定）。
 *
 * 独立成非 client 模块：RSC 页面（任务页列表视图）与客户端组件
 * （`SpaceTaskTable` 的乐观更新同步）共用同一排序口径——"use client"
 * 模块导出的函数在服务端是 client reference，不可直接调用。
 */
export function sortTaskRows<
  T extends { dueDate: string | null; priority: TaskPriority },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aDue = a.dueDate ?? NO_DUE_DATE;
    const bDue = b.dueDate ?? NO_DUE_DATE;
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;

    // 与 compareByPriority 同口径：TASK_PRIORITY_ORDER 索引差取反（高在前）。
    return (
      TASK_PRIORITY_ORDER.indexOf(b.priority) -
      TASK_PRIORITY_ORDER.indexOf(a.priority)
    );
  });
}
