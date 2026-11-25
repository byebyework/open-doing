// 项目详情页 tab 参数（`?tab=`）的唯一出口。
//
// 与任务模块 `?view=list` 同一约定：缺省 / 非法值一律回落概览，
// URL 只在离开概览时携带 `tab=tasks|activity`（概览为干净地址）。
// 同时承载任务 tab 的列表筛选解析（`?status=&priority=&tag=`）。
// 纯函数，无 React / 无 IO。

import type { ListFilters } from "@/features/kanban/sort-task-rows";

/** tab 参数名（`?tab=tasks`）。 */
export const PROJECT_TAB_PARAM = "tab";

export type ProjectTab = "overview" | "tasks" | "activity";

/** Next 的 searchParams 值形态（同名参数可能是数组）。 */
type SearchParamsLike = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 解析 tab：白名单外 / 缺省一律 overview（静默回退，与 ?view 同口径）。 */
export function parseProjectTab(
  value: string | string[] | undefined,
): ProjectTab {
  const raw = first(value);
  if (raw === "tasks" || raw === "activity") return raw;
  return "overview";
}

/** 从页面 searchParams 解析 tab（等价于 parseProjectTab(params[PROJECT_TAB_PARAM])）。 */
export function parseProjectTabFrom(
  params: SearchParamsLike,
): ProjectTab {
  return parseProjectTab(params[PROJECT_TAB_PARAM]);
}

/** 项目任务 tab 的列表筛选白名单（与任务模块统计带同口径）。 */
const TASK_FILTER_STATUSES = ["todo", "in_progress", "done"] as const;
const TASK_FILTER_PRIORITIES = ["low", "medium", "high"] as const;

/**
 * 解析项目任务 tab 的列表筛选（`?status=&priority=&tag=`）：
 * 白名单外 / 缺省一律 "all"（静默回退，与 `?view=` 同口径）。
 * tag 是标签 id，任意非空字符串即透传。
 */
export function parseProjectTaskFilters(
  params: SearchParamsLike,
): ListFilters {
  const status = first(params.status);
  const priority = first(params.priority);
  const tag = first(params.tag);

  return {
    status:
      status && (TASK_FILTER_STATUSES as readonly string[]).includes(status)
        ? (status as ListFilters["status"])
        : "all",
    priority:
      priority && (TASK_FILTER_PRIORITIES as readonly string[]).includes(priority)
        ? (priority as ListFilters["priority"])
        : "all",
    tag: tag ? tag : "all",
  };
}
