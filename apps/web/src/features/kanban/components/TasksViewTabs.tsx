"use client";

import { motion, type Variants } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { OD_EASE, OD_MS } from "@/components/ui/overlay-motion";
import { cn } from "@/lib/utils";

import {
  ListFiltersProvider,
  type ListFiltersContextValue,
} from "../list-filters-context";
import { DEFAULT_LIST_FILTERS, type ListFilters } from "../sort-task-rows";
import { TaskListFilters } from "./TaskListFilters";
import { TaskProjectFilter } from "./TaskProjectFilter";

/** 双视图标识：board=看板（SpaceKanban），list=列表（任务表格）。 */
export type TasksView = "board" | "list";

export interface TasksViewTabsProps {
  /** RSC 从 `?view=` 解析出的初始视图（board 时参数缺省）。 */
  initialView: TasksView;
  /** 看板视图内容（RSC 传入；两面板常驻挂载，切走不卸载）。 */
  board: ReactNode;
  /** 列表视图内容（RSC 传入）。 */
  list: ReactNode;
  /** 项目池（RSC 传入）；项目筛选两视图常驻，本地筛选组仅列表激活时渲染。 */
  projects?: { id: string; name: string; slug: string }[];
  /** 项目进度（0~1，slug → 进度，团队空间）；透传 `TaskProjectFilter`。 */
  projectProgress?: Record<string, number>;
  /** 「全部项目」聚合进度；与 projectProgress 同时传入。 */
  allProjectsProgress?: number;
  /** 标签筛选选项（task 标签池切片）；缺省 / 空数组时不渲染标签下拉。 */
  tagOptions?: { id: string; name: string }[];
  /** 里程碑筛选选项（当前项目里程碑）；缺省 / 空数组时不渲染里程碑下拉。 */
  milestoneOptions?: { id: string; name: string }[];
}

/**
 * 激活指示胶囊的 layoutId：两枚 tab 共享，切换时胶囊从旧 tab 滑到新 tab
 * （先例 LanguageSwitch；transform 类动画，MotionConfig reducedMotion
 * "user" 下自动失效为瞬时定位）。
 */
const ACTIVE_PILL_LAYOUT_ID = "tasks-view-active-pill";

/**
 * 面板切行动效：active 归位淡入（OD_MS.overlayIn decelerate），inactive
 * 按方向 custom d 滑出淡出（OD_MS.popOut accelerate，d=+1 向左切列表 /
 * d=-1 向右切回看板）。两面板常驻，非激活面板再叠 inert + aria-hidden
 * 挡交互与读屏。
 */
const panelVariants: Variants = {
  active: {
    opacity: 1,
    x: 0,
    transition: { duration: OD_MS.overlayIn / 1000, ease: OD_EASE.decelerate },
  },
  inactive: (d: number) => ({
    opacity: 0,
    x: -16 * d,
    transition: { duration: OD_MS.popOut / 1000, ease: OD_EASE.accelerate },
  }),
};

const TAB_META: Record<
  TasksView,
  { testid: string; panelId: string }
> = {
  board: { testid: "tasks-view-tab-board", panelId: "tasks-view-panel-board" },
  list: { testid: "tasks-view-tab-list", panelId: "tasks-view-panel-list" },
};

/**
 * 任务页看板 / 列表双视图壳：分段控件 tablist（浅灰轨道 + 白色滑动指示
 * 胶囊，先例 LanguageSwitch）+ 常驻双面板。列表视图下 tab 行右侧挂本地
 * 筛选组（`TaskListFilters`，provider 包住两视图共享筛选 state）。切换纯客户端（URL replaceState
 * 记 `?view=list`，看板删参回归默认），不触发 RSC 重取；键盘遵循 tabs
 * 惯例——roving tabindex，方向键切换且焦点随迁。
 */
export function TasksViewTabs({
  initialView,
  board,
  list,
  projects,
  projectProgress,
  allProjectsProgress,
  tagOptions,
  milestoneOptions,
}: TasksViewTabsProps) {
  const t = useTranslations("kanban");
  const [view, setView] = useState<TasksView>(initialView);
  const [dir, setDir] = useState(1); // +1 切向列表 / -1 切向看板
  // 列表本地筛选 state 归容器所有：provider 包住两视图，切 tab 重置
  // （刷新自然归零）——本地快筛，不跨视图保留。
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_LIST_FILTERS);
  const boardTabRef = useRef<HTMLButtonElement>(null);
  const listTabRef = useRef<HTMLButtonElement>(null);

  // WHY: 里程碑选项是项目级的，而筛选 state 跨 ?project= 切换不重置——
  // 选项集合变了、旧 id 失效时必须回 all，否则行被幽灵 id 滤空且下拉
  // 可能已隐藏（无从清除）。渲染期派生同步（同 SpaceTaskTable filterKey）。
  const milestoneOptionList = milestoneOptions ?? [];
  if (
    filters.milestone !== "all" &&
    !milestoneOptionList.some((option) => option.id === filters.milestone)
  ) {
    setFilters((current) => ({ ...current, milestone: "all" }));
  }

  const filtersContext: ListFiltersContextValue = {
    filters,
    setFilter: (patch) => {
      setFilters((current) => ({ ...current, ...patch }));
    },
    tagOptions: tagOptions ?? [],
    milestoneOptions: milestoneOptions ?? [],
  };

  function switchTo(next: TasksView) {
    if (next === view) return;
    setDir(next === "list" ? 1 : -1);
    setView(next);
    if (next === "board") setFilters(DEFAULT_LIST_FILTERS);
    // URL 同步：list 记 ?view=list，board 回归默认（删参）；分页参数只对列表
    // 有意义，切回看板时一并清掉，避免 `?page=3` 这类残留参数。
    const url = new URL(window.location.href);
    if (next === "list") {
      url.searchParams.set("view", "list");
    } else {
      url.searchParams.delete("view");
      url.searchParams.delete("page");
      url.searchParams.delete("size");
    }
    window.history.replaceState(null, "", url);
    // 焦点随迁（键盘方向键切换时落到新激活 tab；点击本就聚焦，等价幂等）。
    (next === "board" ? boardTabRef : listTabRef).current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" && view === "board") switchTo("list");
    else if (event.key === "ArrowLeft" && view === "list") switchTo("board");
  }

  const tabRefs: Record<TasksView, React.RefObject<HTMLButtonElement | null>> = {
    board: boardTabRef,
    list: listTabRef,
  };
  const labels: Record<TasksView, string> = {
    board: t("tabBoard"),
    list: t("tabList"),
  };
  const slots: Record<TasksView, ReactNode> = { board, list };

  return (
    <ListFiltersProvider value={filtersContext}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            onKeyDown={handleKeyDown}
            className="inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] bg-(--ink-900)/[0.04] p-[3px]"
          >
            {(Object.keys(TAB_META) as TasksView[]).map((key) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  ref={tabRefs[key]}
                  type="button"
                  role="tab"
                  id={TAB_META[key].testid}
                  aria-selected={active}
                  aria-controls={TAB_META[key].panelId}
                  tabIndex={active ? 0 : -1}
                  data-testid={TAB_META[key].testid}
                  onClick={() => switchTo(key)}
                  className={cn(
                    "relative inline-flex h-7 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] px-3 text-[13px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]",
                    active
                      ? "font-semibold text-primary"
                      : "text-[var(--ink-500)] hover:text-[var(--ink-900)]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={ACTIVE_PILL_LAYOUT_ID}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[var(--radius-pill)] bg-(--surface-white) shadow-[var(--shadow-rest)]"
                      transition={{ duration: OD_MS.popIn / 1000, ease: OD_EASE.springIn }}
                    />
                  )}
                  <span className="relative z-10">{labels[key]}</span>
                </button>
              );
            })}
          </div>
          {/* 右侧筛选组：项目筛选（URL 驱动）两视图常驻；列表视图追加
              状态 / 优先级本地筛选。无项目池且非列表视图时不渲染任何筛选。
              flex-wrap 让 375px 下筛选组折到 tab 行下方。 */}
          {projects?.length || view === "list" ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {view === "list" ? <TaskListFilters /> : null}
              {projects?.length ? (
                <TaskProjectFilter
                  projects={projects}
                  projectProgress={projectProgress}
                  allProjectsProgress={allProjectsProgress}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {/* 双面板常驻挂载：激活面板留在文档流，容器高度跟随激活视图；
            非激活面板 absolute 脱离布局高度（避免长列表把默认看板视图撑出
            大片空白）。视觉显隐全靠 variants 的 opacity/x。
            mt-5 让工具栏行与内容之间留出呼吸空隙（两视图共用）。 */}
        <div className="relative mt-5">
          {(["board", "list"] as TasksView[]).map((key) => {
            const active = view === key;
            return (
              <motion.div
                key={key}
                custom={dir}
                initial={false}
                animate={active ? "active" : "inactive"}
                variants={panelVariants}
                role="tabpanel"
                id={TAB_META[key].panelId}
                aria-labelledby={TAB_META[key].testid}
                aria-hidden={active ? undefined : true}
                inert={!active}
                data-testid={TAB_META[key].panelId}
                className={cn(
                  // 非激活面板 absolute 贴顶、不贡献容器高度；激活面板保持
                  // 流式（block）撑起容器高度。min-w-0 保留：列表内 920px
                  // 表格需由内层 overflow-x-auto 滚动，不得撑出页面宽度。
                  "min-w-0",
                  !active && "pointer-events-none absolute inset-x-0 top-0",
                )}
              >
                {slots[key]}
              </motion.div>
            );
          })}
        </div>
      </div>
    </ListFiltersProvider>
  );
}
