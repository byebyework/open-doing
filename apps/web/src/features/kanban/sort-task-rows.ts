import type { Tag, TaskPriority, TaskStatus } from "@open-doing/types";
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

/** 列表视图本地筛选字段（"all" 表示不过滤）；项目过滤由服务端 `?project=` 承担。 */
export interface ListFilters {
  status: TaskStatus | "all";
  priority: TaskPriority | "all";
  /** 标签 id；"all" 不过滤。项目任务 tab 经 URL `?tag=` 往返保持该值。 */
  tag: string | "all";
}

export const DEFAULT_LIST_FILTERS: ListFilters = {
  status: "all",
  priority: "all",
  tag: "all",
};

/**
 * 列表视图本地行过滤：字段按交集收窄，保序、纯函数（不改动入参）。
 * 收窄只在客户端做（行数据由 RSC 整批取回）；筛选值本身是否镜像进 URL
 * 由调用方决定（任务模块本地态 / 项目任务 tab 经 `?status=&priority=&tag=`）。
 */
export function filterTaskRows<
  T extends {
    status: TaskStatus;
    priority: TaskPriority;
    tags?: Tag[];
  },
>(rows: T[], filters: ListFilters): T[] {
  return rows.filter(
    (row) =>
      (filters.status === "all" || row.status === filters.status) &&
      (filters.priority === "all" || row.priority === filters.priority) &&
      (filters.tag === "all" || row.tags?.some((item) => item.id === filters.tag)),
  );
}
