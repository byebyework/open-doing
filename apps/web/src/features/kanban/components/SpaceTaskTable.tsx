"use client";

import type { TaskStatus } from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/EmptyState";
import { PriorityChip } from "@/components/ui/PriorityChip";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { updatePersonalTaskAction } from "@/features/personal/tasks/actions";
import { TaskTags } from "@/features/tags/components/TaskTags";
import { canEditTask } from "@/features/tasks/permissions";
import { updateTeamTaskAction } from "@/features/tasks/actions";
import type { TeamRole } from "@/features/teams/permissions";
import {
  appendTaskOrigin,
  DEFAULT_TASK_PAGE_SIZE,
  TASK_PAGE_SIZES,
  type TaskPageSize,
} from "@/lib/task-origin";

import { useListFilters } from "../list-filters-context";
import { filterTaskRows, sortTaskRows } from "../sort-task-rows";
import type { KanbanCardItem, TeamKanbanCardItem } from "../service";
import {
  DueLabel,
  firstError,
  ProjectTag,
  STATUS_KEYS,
  STATUS_ORDER,
} from "./SpaceKanban";

/**
 * 组件内部行模型：个人行没有指派人字段，团队行在基类上补充
 * `assigneeId` / `assigneeName`（可选，运行时由 variant 决定是否存在）。
 */
type TaskRow = KanbanCardItem & {
  assigneeId?: string | null;
  assigneeName?: string | null;
};

/** 空间级任务列表入参（个人 / 团队共用，团队专有字段可选）。 */
export interface SpaceTaskTableProps {
  variant: "personal" | "team";
  /** 运行时由 variant 决定：个人传 `KanbanCardItem[]`，团队传 `TeamKanbanCardItem[]`。 */
  rows: KanbanCardItem[] | TeamKanbanCardItem[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），逾期 / 临期判定用。 */
  today: string;
  /** taskId → 详情页 href（RSC 用 routes builder 生成，可能缺少部分卡片）。 */
  taskHrefs: Record<string, string>;
  // 团队专有
  teamId?: string;
  teamSlug?: string;
  role?: TeamRole;
  actorId?: string;
  /**
   * 详情链接来源。传 `"tasks"` 时行标题链接带 `?from=tasks&view=list`，
   * 传 `"project"` 时带 `?from=project&view=list`（非首页再带 `page` /
   * `size`），详情页据此把返回链接指回对应入口的列表同一页；RSC 按入口传，
   * 其它入口保持「返回项目」。
   */
  taskOrigin?: "tasks" | "project";
  /** URL `?page=` 解析出的初始页码（详情返回同一页时由 RSC 传入）。 */
  initialPage?: number;
  /** URL `?size=` 解析出的初始每页条数（白名单外由 RSC 过滤为 undefined）。 */
  initialPageSize?: TaskPageSize;
}

/** 状态 pill 配色（与看板卡 / badge 同一组 token，无字面量色值）。 */
const STATUS_TONE: Record<TaskStatus, string> = {
  todo: "bg-[var(--status-todo-bg)] text-[var(--status-todo)]",
  in_progress: "bg-[var(--status-progress-bg)] text-[var(--status-progress)]",
  done: "bg-[var(--status-done-bg)] text-[var(--status-done)]",
};

/**
 * 行内状态列：单个当前状态 pill（触发器 `task-status-pill`），可编辑行
 * 点击弹出三项状态菜单（testid 契约 `task-status-button-{status}` 迁移到
 * 菜单项，e2e 改「点 pill → 点菜单项」）；不可编辑行 pill 纯展示（disabled）。
 */
function TaskRowStatusPill({
  row,
  editable,
  pending,
  onStatusChange,
}: {
  row: TaskRow;
  editable: boolean;
  /** 全表单行的乐观更新占位（行内 pill 在自家行变更期间禁用）。 */
  pending: { id: string; status: TaskStatus } | null;
  onStatusChange: (row: TaskRow, status: TaskStatus) => void;
}) {
  const t = useTranslations("kanban");
  const rowPending = pending !== null && pending.id === row.id;
  // pending 是全表单 token：变更在飞期间所有行的 pill 一并禁用
  // （handleStatusChange 会早退，不能只让 pending 行看起来不可点）。
  const tablePending = pending !== null;

  const pill = (
    <button
      type="button"
      data-testid="task-status-pill"
      disabled={!editable || tablePending}
      aria-haspopup={editable ? "menu" : undefined}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold leading-none transition-colors disabled:cursor-not-allowed ${STATUS_TONE[row.status]} ${
        editable && !tablePending
          ? "cursor-pointer hover:shadow-[var(--shadow-rest)]"
          : ""
      }`}
    >
      {rowPending ? (
        <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
      ) : null}
      {t(STATUS_KEYS[row.status])}
      {editable ? (
        <ChevronDownIcon aria-hidden className="size-3 opacity-70" />
      ) : null}
    </button>
  );

  if (!editable) return pill;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{pill}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {STATUS_ORDER.map((status) => (
          <DropdownMenuItem
            key={status}
            data-testid={`task-status-button-${status}`}
            disabled={status === row.status || tablePending}
            onSelect={() => {
              onStatusChange(row, status);
            }}
          >
            <span
              aria-hidden
              className={`inline-flex size-2 flex-none rounded-full ${STATUS_TONE[status]}`}
            />
            <span className="flex-1">{t(STATUS_KEYS[status])}</span>
            {status === row.status ? (
              <CheckIcon aria-hidden className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 空间级任务列表（个人 / 团队共用，任务页「列表」视图）。
 *
 * - 7 列：标题 / 项目 / 标签 / 优先级 / 状态 / 进度 / 截止；团队在状态后
 *   插入负责人列（8 列）；标题链接 + 行内状态切换即 v1 全部行内能力，无操作列；
 * - 默认排序 `sortTaskRows`（截止升序 null 最后，同日优先级高在前）；
 * - 状态切换乐观更新（sync props → state during render），失败回滚并 toast，
 *   action 分支与错误口径照抄 `SpaceKanban`（个人 / 团队 / 缺 teamId 三分支）；
 * - 截止列复用看板 `DueLabel`（逾期红 / 临期琥珀 / done 完成日期，`today` 口径）；
 * - 客户端分页：默认每页 10 条（可选 20 / 50），条数超过 10 才出现分页行；
 *   换筛选 / 换条数回第 1 页，页码越界渲染期收敛（行集合刷新不跳页）；
 *   任务模块来源时行标题链接带 `?from=tasks&view=list&page&size`，详情页
 *   「← 返回任务」据此回到同一页（`lib/task-origin`）。
 */
export function SpaceTaskTable({
  variant,
  rows,
  today,
  taskHrefs,
  teamId,
  role,
  actorId,
  taskOrigin,
  initialPage,
  initialPageSize,
}: SpaceTaskTableProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tTags = useTranslations("tags");
  const tKanban = useTranslations("kanban");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");

  // 列表视图本地筛选（Task 2 挂 provider）；无 provider 时三项全 "all"。
  const { filters } = useListFilters();

  const taskRows: TaskRow[] = rows;

  // 分页：客户端切片（行数据本来就整批由 RSC 取回）。页码 / 每页条数变化时
  // 经 replaceState 写回 URL（不触发 RSC；先例 TasksViewTabs 的 view 同步）：
  // 详情链接把它们作为来源参数带出去，项目详情任务 tab 切走再切回时由 RSC
  // 读 `?page` / `?size` 还原位置（见 lib/task-origin / lib/project-tab）。
  const [page, setPage] = useState(() =>
    initialPage != null && initialPage > 0 ? initialPage : 1,
  );
  const [pageSize, setPageSize] = useState<TaskPageSize>(
    initialPageSize ?? DEFAULT_TASK_PAGE_SIZE,
  );

  /** 分页状态 → URL（只动 page / size，tab / view 等参数原样保留）。 */
  function syncPagingToUrl(nextPage: number, nextSize: TaskPageSize): void {
    const url = new URL(window.location.href);
    if (nextPage > 1) url.searchParams.set("page", String(nextPage));
    else url.searchParams.delete("page");
    if (nextSize !== DEFAULT_TASK_PAGE_SIZE) {
      url.searchParams.set("size", String(nextSize));
    } else {
      url.searchParams.delete("size");
    }
    window.history.replaceState(null, "", url);
  }

  // 服务端刷新（router.refresh）后以最新 props 为准；渲染期同步 props → state
  // 是 React 推荐写法（同 SpaceKanban），避免 effect 多跑一轮渲染。行集合
  // 变化不重置页码（页内改状态也会 refresh）：越界由渲染期收敛处理。
  const [localRows, setLocalRows] = useState<TaskRow[]>(() =>
    sortTaskRows(taskRows),
  );
  const [syncedRows, setSyncedRows] = useState(taskRows);
  if (taskRows !== syncedRows) {
    setSyncedRows(taskRows);
    setLocalRows(sortTaskRows(taskRows));
  }

  // 本地筛选（状态 / 优先级 / 标签 / 里程碑）变化时同样回第 1 页：结果集换了，旧页码没有意义。
  const filterKey = `${filters.status}:${filters.priority}:${filters.tag}:${filters.milestone}`;
  const [syncedFilterKey, setSyncedFilterKey] = useState(filterKey);
  if (filterKey !== syncedFilterKey) {
    setSyncedFilterKey(filterKey);
    setPage(1);
  }

  const [pending, setPending] = useState<{
    id: string;
    status: TaskStatus;
  } | null>(null);

  /** 编辑权只看角色 / 责任人；个人空间恒可编辑。 */
  function canEditRow(row: TaskRow): boolean {
    if (variant === "personal") return true;

    return canEditTask({
      role: role ?? null,
      actorId: actorId ?? "",
      assigneeId: row.assigneeId ?? null,
    });
  }

  async function handleStatusChange(row: TaskRow, status: TaskStatus) {
    if (pending || status === row.status) return;

    const originalStatus = row.status;

    setPending({ id: row.id, status });
    // 乐观更新：只改该行状态（排序键与状态无关，行序不变）。
    setLocalRows((current) =>
      current.map((item) => (item.id === row.id ? { ...item, status } : item)),
    );

    // 失败回滚用功能式更新只改回该行（originalStatus 在乐观更新前捕获）：
    // 乐观更新与回滚之间落地的其他行状态变更不会被旧快照覆盖。
    const revert = () =>
      setLocalRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, status: originalStatus } : item,
        ),
      );

    try {
      let errors: Record<string, string> | null = null;

      if (variant === "personal") {
        const result = await updatePersonalTaskAction(row.id, { status });
        if (!result.ok) errors = result.errors;
      } else if (teamId) {
        const result = await updateTeamTaskAction(row.id, { teamId, status });
        if (!result.ok) errors = result.errors;
      } else {
        revert();
        return;
      }

      if (errors) {
        revert();
        toast.error(firstError(errors, tErrors("operationFailed")));
        return;
      }

      router.refresh();
    } catch {
      revert();
      toast.error(tCommon("networkError"));
    } finally {
      setPending(null);
    }
  }

  // 过滤保持既有排序（localRows 已排序），纯派生于渲染期，不进 state。
  const visibleRows = filterTaskRows(localRows, filters);

  // 页码越界渲染期收敛（不写回 state）：删任务 / 筛选收窄后不会停在空页。
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = visibleRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  // 条数超过最小页容量就保留分页行：否则每页切到 20/50 后控件会消失，
  // 用户无法切回 10。
  const showPagination = visibleRows.length > DEFAULT_TASK_PAGE_SIZE;

  /** 行标题链接：任务模块 / 项目任务 tab 来源时带返回所需的来源参数（含当前页）。 */
  function detailHref(taskId: string): string | undefined {
    const base = taskHrefs[taskId];
    if (!base || (taskOrigin !== "tasks" && taskOrigin !== "project")) return base;

    // 项目来源把非 all 的筛选一并带上：回跳「← 返回项目」还原筛选
    // （任务模块来源不带——模块筛选是本地态，进 URL 会撞统计带语义）。
    const isProject = taskOrigin === "project";
    return appendTaskOrigin(base, {
      ...(isProject ? { fromProject: true } : {}),
      ...(isProject && filters.status !== "all" ? { status: filters.status } : {}),
      ...(isProject && filters.priority !== "all"
        ? { priority: filters.priority }
        : {}),
      ...(isProject && filters.tag !== "all" ? { tag: filters.tag } : {}),
      view: "list",
      page: currentPage,
      pageSize,
    });
  }

  if (visibleRows.length === 0) {
    return (
      <EmptyState
        title={tKanban("listEmptyTitle")}
        description={tKanban("listEmptyDescription")}
      />
    );
  }

  // 列序按任务页列表原型（无操作列）。
  const columns: { label: string; className: string }[] = [
    { label: t("colTask"), className: "" },
    { label: t("projectLabel"), className: "min-w-[110px]" },
    { label: t("colMilestone"), className: "min-w-[90px]" },
    { label: tTags("tagNameLabel"), className: "min-w-[130px]" },
    { label: t("priority"), className: "min-w-[72px]" },
    { label: t("statusLabel"), className: "min-w-24" },
    ...(variant === "team"
      ? [{ label: t("assigneeLabel"), className: "min-w-[120px]" }]
      : []),
    { label: t("colProgress"), className: "min-w-[170px]" },
    { label: t("dueDateLabel"), className: "min-w-[130px]" },
  ];

  return (
    <>
      {/* 窄屏：表格横向滚动，页面本身不横向溢出。 */}
      <div className="overflow-x-auto">
        <table
          data-testid="space-task-table"
          className="w-full min-w-[920px] border-collapse text-left text-[13.5px]"
        >
          <thead>
            <tr>
              {columns.map(({ label, className }) => (
                <th
                  key={label}
                  className={`whitespace-nowrap border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)] ${className}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child_td]:border-b-0">
            {pageRows.map((row) => {
              const done = row.status === "done";
              // 用「子任务计数」还原 getTaskProgress 入参，保持进度口径唯一
              // （与团队看板项目进度的还原方式一致）。
              const progress = getTaskProgress({
                status: row.status,
                subtasks: Array.from(
                  { length: row.subtaskTotal },
                  (_, index) => ({ completed: index < row.subtaskDone }),
                ),
              });

              return (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-[#f4f5f7] ${
                    done ? "opacity-[0.62]" : ""
                  }`}
                >
                  {/* 标题列限宽 + 单行省略：无空格长串不再撑出横向滚动 */}
                  <td className="w-[40%] max-w-0 border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    {detailHref(row.id) ? (
                      <Link
                        href={detailHref(row.id)!}
                        className={`block truncate font-medium ${
                          done
                            ? "text-[var(--ink-400)] line-through"
                            : "text-[var(--ink-900)] no-underline hover:underline"
                        }`}
                      >
                        {row.title}
                      </Link>
                    ) : (
                      <span
                        className={`block truncate font-medium ${
                          done
                            ? "text-[var(--ink-400)] line-through"
                            : "text-[var(--ink-900)]"
                        }`}
                      >
                        {row.title}
                      </span>
                    )}
                  </td>

                  <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    <ProjectTag variant={variant} projectName={row.projectName} />
                  </td>

                  <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    {row.milestoneName ? (
                      <span className="whitespace-nowrap text-[13px] text-[var(--color-text-secondary)]">
                        {row.milestoneName}
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-[var(--ink-400)]">—</span>
                    )}
                  </td>

                  <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    {(row.tags ?? []).length > 0 ? (
                      <TaskTags tags={row.tags ?? []} />
                    ) : (
                      <span className="text-[12.5px] text-[var(--ink-400)]">—</span>
                    )}
                  </td>

                  <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    <PriorityChip priority={row.priority} />
                  </td>

                  <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    <TaskRowStatusPill
                      row={row}
                      editable={canEditRow(row)}
                      pending={pending}
                      onStatusChange={(target, status) => {
                        void handleStatusChange(target, status);
                      }}
                    />
                  </td>

                  {variant === "team" ? (
                    <td className="whitespace-nowrap border-b border-[var(--border-default)] px-3 py-3 align-middle">
                      {row.assigneeName ? (
                        <span className="flex items-center gap-2 text-[13px] text-[var(--ink-900)]">
                          {/* Avatar color is keyed by user id; "" is a deterministic sentinel never seeded from the name. */}
                          <UserAvatar
                            userId={row.assigneeId ?? ""}
                            name={row.assigneeName}
                            size={26}
                          />
                          {row.assigneeName}
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-[var(--ink-400)]">
                          {t("unassigned")}
                        </span>
                      )}
                    </td>
                  ) : null}

                  <td className="whitespace-nowrap border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    {done ? (
                      <span className="text-[12.5px] text-[var(--ink-400)]">—</span>
                    ) : row.subtaskTotal > 0 ? (
                      <div>
                        <div className="mb-1 w-[110px]">
                          <ProgressBar value={progress} />
                        </div>
                        <span className="text-[12px] text-[var(--ink-400)]">
                          {t("tableSubtasksProgress", {
                            completed: row.subtaskDone,
                            total: row.subtaskTotal,
                            percent: Math.round(progress * 100),
                          })}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[12px] text-[var(--ink-400)]">
                        {t("noSubtasksProgress", {
                          percent: Math.round(progress * 100),
                        })}
                      </span>
                    )}
                  </td>

                  <td className="whitespace-nowrap border-b border-[var(--border-default)] px-3 py-3 align-middle">
                    <DueLabel card={row} today={today} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 客户端分页：条数超过最小页容量才出现（每页条数 / 页码 / 上下一页）。 */}
      {showPagination ? (
        <div className="mt-3 flex items-center justify-end gap-3 text-[12.5px] text-[var(--color-text-muted)]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="task-list-page-size"
                className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]"
              >
                {t("pageSizeLabel", { count: pageSize })}
                <ChevronDownIcon aria-hidden className="size-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {TASK_PAGE_SIZES.map((size) => (
                <DropdownMenuItem
                  key={size}
                  data-testid={`task-list-page-size-${size}`}
                  disabled={size === pageSize}
                  onSelect={() => {
                    setPageSize(size);
                    setPage(1);
                    syncPagingToUrl(1, size);
                  }}
                >
                  <span className="flex-1">
                    {t("pageSizeLabel", { count: size })}
                  </span>
                  {size === pageSize ? (
                    <CheckIcon aria-hidden className="size-3.5" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span data-testid="task-list-page-info">
            {t("pageInfo", {
              page: currentPage,
              total: totalPages,
              count: visibleRows.length,
            })}
          </span>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("prevPageAria")}
              data-testid="task-list-page-prev"
              disabled={currentPage <= 1}
              onClick={() => {
                const next = Math.max(1, currentPage - 1);
                setPage(next);
                syncPagingToUrl(next, pageSize);
              }}
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("nextPageAria")}
              data-testid="task-list-page-next"
              disabled={currentPage >= totalPages}
              onClick={() => {
                const next = Math.min(totalPages, currentPage + 1);
                setPage(next);
                syncPagingToUrl(next, pageSize);
              }}
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
