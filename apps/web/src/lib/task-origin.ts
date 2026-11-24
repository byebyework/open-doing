// 任务详情页「来源」参数的唯一出口。
//
// 任务详情路由挂在项目下（`/space/{team}/projects/{slug}/tasks/{id}`），
// 但从任务模块（看板 / 列表）点进去时，返回链接应该回到任务模块而不是
// 项目页；从项目详情的「任务」tab（内嵌看板 / 列表）点进去时，应回到
// 项目页的 `?tab=tasks` 同视图。页面不读 referrer（不可靠），改为在详情
// 链接上显式带来源参数：
//
//   ?from=tasks                 任务模块看板卡片
//   ?from=tasks&view=list&page=2&size=20   任务模块列表行（回到同一页）
//   ?from=project               项目详情任务 tab 看板卡片
//   ?from=project&view=list&page=2&size=20 项目详情任务 tab 列表行
//
// 详情页据此决定 backHref / backLabel；没有 `from` 的入口（项目页概览、
// 日历、仪表盘、通知）维持「返回项目」（概览）。纯函数，无 React / 无 IO。

import { moduleHref, type SpaceRef } from "./routes";

/** 来源参数名与取值（`?from=tasks` / `?from=project`）。 */
export const TASK_ORIGIN_PARAM = "from";
export const TASK_ORIGIN_TASKS = "tasks";
export const TASK_ORIGIN_PROJECT = "project";

/** 列表视图每页条数可选项（默认第一项）；与 `SpaceTaskTable` 共用。 */
export const TASK_PAGE_SIZES = [10, 20, 50] as const;
export type TaskPageSize = (typeof TASK_PAGE_SIZES)[number];
export const DEFAULT_TASK_PAGE_SIZE: TaskPageSize = 10;

/** 页码上限：只用于把异常 URL 收敛到可渲染范围，不参与业务规则。 */
const MAX_PAGE = 10_000;

/** Next 的 searchParams 值形态（同名参数可能是数组）。 */
export type SearchParamsLike = Record<
  string,
  string | string[] | undefined
>;

/** 详情页解析出的来源：决定返回链接指向任务模块还是项目页任务 tab。 */
export interface TaskOrigin {
  /** 链接来自任务模块（看板 / 列表）。 */
  fromTasks: boolean;
  /** 链接来自项目详情的「任务」tab（内嵌看板 / 列表）。 */
  fromProject: boolean;
  /** 列表视图来源（看板入口不带 view）。 */
  view: "list" | null;
  /** 列表页码（仅 > 1 时由链接携带）。 */
  page: number | null;
  /** 列表每页条数（仅非默认值时由链接携带）。 */
  pageSize: TaskPageSize | null;
}

/** 详情链接需要带上的来源参数（默认 `from=tasks`；`fromProject` 优先）。 */
export interface TaskOriginParams {
  fromTasks?: boolean;
  fromProject?: boolean;
  view?: "list" | null;
  page?: number | null;
  pageSize?: TaskPageSize | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 解析页码：非正整数 / 超范围一律 null（静默回退，不报错）。 */
export function parseTaskPage(
  value: string | string[] | undefined,
): number | null {
  const raw = first(value);
  if (!raw) return null;

  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return null;

  return page;
}

/** 解析每页条数：白名单外回退 null（与项目筛选非法 slug 同口径）。 */
export function parseTaskPageSize(
  value: string | string[] | undefined,
): TaskPageSize | null {
  const raw = first(value);
  if (!raw) return null;

  const size = Number(raw);
  return (TASK_PAGE_SIZES as readonly number[]).includes(size)
    ? (size as TaskPageSize)
    : null;
}

/**
 * 从详情页 searchParams 解析来源；`from=tasks` → 任务模块，
 * `from=project` → 项目详情任务 tab，其余（含缺失）为非任务来源。
 */
export function parseTaskOrigin(params: SearchParamsLike): TaskOrigin {
  const from = first(params[TASK_ORIGIN_PARAM]);
  const fromTasks = from === TASK_ORIGIN_TASKS;
  const fromProject = from === TASK_ORIGIN_PROJECT;

  if (!fromTasks && !fromProject) {
    return { fromTasks: false, fromProject: false, view: null, page: null, pageSize: null };
  }

  return {
    fromTasks,
    fromProject,
    view: first(params.view) === "list" ? "list" : null,
    page: parseTaskPage(params.page),
    pageSize: parseTaskPageSize(params.size),
  };
}

/**
 * 给任务详情 href 追加来源参数。默认页码 / 条数不写进 URL
 * （`page=1`、`size=10` 是缺省值，写上只会让链接变吵）。
 */
export function appendTaskOrigin(
  href: string,
  params: TaskOriginParams = {},
): string {
  const search = new URLSearchParams();

  if (params.fromProject) {
    // from=project 优先于 fromTasks（互斥来源）。
    search.set(TASK_ORIGIN_PARAM, TASK_ORIGIN_PROJECT);
  } else if (params.fromTasks !== false) {
    search.set(TASK_ORIGIN_PARAM, TASK_ORIGIN_TASKS);
  }
  if (params.view === "list") {
    search.set("view", "list");
  }
  if (params.page != null && params.page > 1) {
    search.set("page", String(params.page));
  }
  if (
    params.pageSize != null &&
    params.pageSize !== DEFAULT_TASK_PAGE_SIZE
  ) {
    search.set("size", String(params.pageSize));
  }

  const query = search.toString();
  if (!query) return href;

  return `${href}${href.includes("?") ? "&" : "?"}${query}`;
}

/**
 * 详情页「← 返回任务」地址：任务模块的列表 / 看板入口。
 *
 * 列表来源保留 `view=list` 与页码 / 条数（回到用户点进去的那一页）；
 * 看板来源回到模块默认看板。
 */
export function taskModuleBackHref(
  spaceRef: SpaceRef,
  origin: TaskOrigin,
): string {
  const base = moduleHref(spaceRef, "tasks");

  if (!origin.fromTasks) return base;

  return appendTaskOrigin(base, {
    // 返回任务模块本身不需要再带来源参数。
    fromTasks: false,
    view: origin.view,
    page: origin.page,
    pageSize: origin.pageSize,
  });
}

/**
 * 项目详情「← 返回项目」地址（`from=project` 来源专用）：
 * 回到项目页的任务 tab 并保留列表视图位置；非项目来源原样返回
 * （调用方走缺省的项目根地址，落在概览 tab）。
 *
 * `tab=tasks` 字面量与 `lib/project-tab.ts` 的 `PROJECT_TAB_PARAM` 同值
 * （project-tab 在任务 tab 之后引入，避免前向依赖）。
 */
export function projectTasksBackHref(
  projectHref: string,
  origin: TaskOrigin,
): string {
  if (!origin.fromProject) return projectHref;

  const search = new URLSearchParams();
  search.set("tab", "tasks");
  if (origin.view === "list") {
    search.set("view", "list");
  }
  if (origin.page != null && origin.page > 1) {
    search.set("page", String(origin.page));
  }
  if (
    origin.pageSize != null &&
    origin.pageSize !== DEFAULT_TASK_PAGE_SIZE
  ) {
    search.set("size", String(origin.pageSize));
  }

  return `${projectHref}?${search.toString()}`;
}
