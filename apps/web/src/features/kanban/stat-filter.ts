import type { TaskStatus } from "@open-doing/types";

/** 统计带筛选的合法 status 值（白名单外静默忽略）。 */
const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** searchParams 单值提取（Next.js 同名参数为数组，取第一个）。 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 解析统计带筛选参数：`?status=todo|in_progress|done`、`?overdue=1`、
 * `?dueSoon=1`（与既有 `?project=` / `?assignee=` 叠加）。
 *
 * 非法值静默回退为「不筛选」（与 project slug 的处理一致）。
 */
export function parseStatFilterParams(params: {
  status?: string | string[];
  overdue?: string | string[];
  dueSoon?: string | string[];
}): {
  status?: TaskStatus;
  overdueOnly?: boolean;
  dueSoonOnly?: boolean;
} {
  const status = first(params.status);
  const overdue = first(params.overdue);
  const dueSoon = first(params.dueSoon);

  return {
    status: STATUSES.includes(status as TaskStatus)
      ? (status as TaskStatus)
      : undefined,
    overdueOnly: overdue === "1" || undefined,
    dueSoonOnly: dueSoon === "1" || undefined,
  };
}
