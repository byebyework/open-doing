// 项目详情页 tab 参数（`?tab=`）的唯一出口。
//
// 与任务模块 `?view=list` 同一约定：缺省 / 非法值一律回落概览，
// URL 只在离开概览时携带 `tab=tasks|activity`（概览为干净地址）。
// 纯函数，无 React / 无 IO。

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
