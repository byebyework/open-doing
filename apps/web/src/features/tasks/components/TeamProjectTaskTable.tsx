"use client";

import type { TaskStatus } from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/shadcn/pagination";
import type { TeamRole } from "@/features/teams/permissions";
import { teamTaskHref } from "@/lib/routes";

import type { TeamTaskRow } from "../service";
import { NewTeamTaskModal } from "./NewTeamTaskModal";
import {
  TEAM_TASK_STATUS_KEYS,
  TEAM_TASK_STATUS_ORDER,
  TeamTaskRowActions,
} from "./TeamTaskRowActions";

/** 状态筛选值：全部 + 三种状态。 */
type StatusFilter = "all" | TaskStatus;

/** 责任人筛选值：`all` / `unassigned` / 具体成员 ID。 */
type AssigneeFilter = string;

/** 排序方式（「按截止日期」为默认）。 */
type SortKey = "dueDate" | "status" | "createdAt";

/** 每页条数（原型 9 行密度）。 */
const PAGE_SIZE = 9;

/** 无截止日期的任务排在最后。 */
const NO_DUE_DATE = "9999-12-31";

const STATUS_WEIGHT: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
};

function compareByDueDate(a: TeamTaskRow, b: TeamTaskRow): number {
  return (
    (a.dueDate ?? NO_DUE_DATE).localeCompare(b.dueDate ?? NO_DUE_DATE) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function compareByStatus(a: TeamTaskRow, b: TeamTaskRow): number {
  return (
    STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
    compareByDueDate(a, b)
  );
}

function compareByCreatedAt(a: TeamTaskRow, b: TeamTaskRow): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** 分页按钮序列：页数少时全展示，多时收敛为「首尾 + 当前邻域」。 */
function pageItems(
  current: number,
  total: number,
): (number | "ellipsis-l" | "ellipsis-r")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const items: (number | "ellipsis-l" | "ellipsis-r")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push("ellipsis-l");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push("ellipsis-r");
  items.push(total);
  return items;
}

/** 列表视图入参（J-4 复用 `tasks` / `today` / `members` 等数据）。 */
export interface TeamProjectTaskTableProps {
  teamId: string;
  teamSlug: string;
  /** 项目全部任务（按创建时间升序）。 */
  tasks: TeamTaskRow[];
  /** 团队成员（责任人筛选与新建任务弹窗使用）。 */
  members: { id: string; name: string }[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`）。 */
  today: string;
  /** 当前项目 ID（新建任务默认选中）。 */
  projectId: string;
  /** 新建任务可选项目（仅本团队）。 */
  projects: { id: string; name: string }[];
  /** 当前用户在该团队的角色（行内权限）。 */
  role: TeamRole;
  /** 当前用户 ID。 */
  actorId: string;
  /** 当前项目 slug（拼任务详情地址）。 */
  projectSlug: string;
}

/**
 * 团队项目列表视图（对照 `project-list.html`）。
 *
 * 5 列：任务 / 状态 / 责任人 / 进度 / 截止日期；筛选状态、责任人、排序，
 * 每页 9 条；已完成行置灰 + 标题删除线。
 */
export function TeamProjectTaskTable({
  teamId,
  teamSlug,
  tasks,
  members,
  today,
  projectId,
  projects,
  role,
  actorId,
  projectSlug,
}: TeamProjectTaskTableProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [sort, setSort] = useState<SortKey>("dueDate");
  const [page, setPage] = useState(1);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const assigneeOptions = [
    { value: "all" as AssigneeFilter, label: t("filterAllAssignee") },
    ...members.map((member) => ({
      value: member.id as AssigneeFilter,
      label: member.name,
    })),
    { value: "unassigned" as AssigneeFilter, label: t("unassigned") },
  ];

  const assigneeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.id, member.name);
    return map;
  }, [members]);

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (assigneeFilter === "unassigned") return task.assigneeId === null;
      if (assigneeFilter !== "all") return task.assigneeId === assigneeFilter;
      return true;
    });

    const comparator =
      sort === "status"
        ? compareByStatus
        : sort === "createdAt"
          ? compareByCreatedAt
          : compareByDueDate;

    return [...filtered].sort(comparator);
  }, [tasks, statusFilter, assigneeFilter, sort]);

  // 筛选变化后回到第 1 页；当前页超出范围时收敛到最后一页。
  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageTasks = visibleTasks.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const isEmptyProject = tasks.length === 0;

  function resetPage() {
    setPage(1);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as StatusFilter);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[120px]" aria-label={t("filterByStatusAria")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAllStatus")}</SelectItem>
            {TEAM_TASK_STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {tStatus(TEAM_TASK_STATUS_KEYS[status])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={assigneeFilter}
          onValueChange={(value) => {
            setAssigneeFilter(value);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[130px]" aria-label={t("filterByAssigneeAria")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assigneeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(value) => {
            setSort(value as SortKey);
            resetPage();
          }}
        >
          <SelectTrigger className="w-[150px]" aria-label={t("sortByAria")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dueDate">{t("sortDueDate")}</SelectItem>
            <SelectItem value="status">{t("sortStatus")}</SelectItem>
            <SelectItem value="createdAt">{t("sortCreatedAt")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[12.5px] text-[var(--ink-400)]">
          {t("totalCount", { count: visibleTasks.length })}
        </span>
      </div>

      <section className="min-w-0 rounded-xl border border-[var(--border-default)] bg-white px-4 py-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:px-5">
        {isEmptyProject ? (
          <EmptyState
            title={t("emptyTasksTitle")}
            description={t("emptyTasksTeamHint")}
            action={
              <Button onClick={() => setNewTaskOpen(true)}>
                {t("newTaskButton")}
              </Button>
            }
          />
        ) : visibleTasks.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[var(--ink-400)]">
            {t("filteredEmpty")}
          </p>
        ) : (
          // 窄屏：表格在卡片内横向滚动，页面本身不横向溢出。
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr>
                  {[
                    t("colTask"),
                    t("statusLabel"),
                    t("assigneeLabel"),
                    t("colProgress"),
                    t("dueDateLabel"),
                  ].map(
                    (label) => (
                      <th
                        key={label}
                        className="border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child_td]:border-b-0">
                {pageTasks.map((task) => {
                  const done = task.status === "done";
                  const progress = getTaskProgress({
                    status: task.status,
                    subtasks: task.subtasks,
                  });
                  const completedCount = task.subtasks.filter(
                    (subtask) => subtask.completed,
                  ).length;
                  const assigneeName = task.assigneeId
                    ? (assigneeNames.get(task.assigneeId) ?? null)
                    : null;
                  const detailHref = teamTaskHref(
                    teamSlug,
                    projectSlug,
                    task.id,
                  );

                  return (
                    <tr
                      key={task.id}
                      className={`transition-colors hover:bg-[#f4f5f7] ${
                        done ? "opacity-[0.62]" : ""
                      }`}
                    >
                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-1">
                          <Link
                            href={detailHref}
                            className={`min-w-0 break-words font-medium ${
                              done
                                ? "text-[var(--ink-400)] line-through"
                                : "text-[var(--ink-900)] no-underline hover:underline"
                            }`}
                          >
                            {task.title}
                          </Link>
                          <TeamTaskRowActions
                            teamId={teamId}
                            task={task}
                            role={role}
                            actorId={actorId}
                            detailHref={detailHref}
                            onChanged={() => router.refresh()}
                          />
                        </div>
                      </td>

                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        <StatusTag status={task.status} />
                      </td>

                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        {assigneeName ? (
                          <span className="flex items-center gap-2 text-[13px] text-[var(--ink-900)]">
                            <UserAvatar username={assigneeName} size={26} />
                            {assigneeName}
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-[var(--ink-400)]">
                            {t("unassigned")}
                          </span>
                        )}
                      </td>

                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        {done ? (
                          <span className="text-[12.5px] text-[var(--ink-400)]">
                            —
                          </span>
                        ) : task.subtasks.length > 0 ? (
                          <div>
                            <div className="mb-1 w-[110px]">
                              <ProgressBar value={progress} />
                            </div>
                            <span className="text-[12px] text-[var(--ink-400)]">
                              {t("tableSubtasksProgress", {
                                completed: completedCount,
                                total: task.subtasks.length,
                                percent: Math.round(progress * 100),
                              })}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[var(--ink-400)]">
                            {t("noSubtasksProgress", { percent: Math.round(progress * 100) })}
                          </span>
                        )}
                      </td>

                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        {task.dueDate ? (
                          <DueText
                            dueDate={task.dueDate}
                            status={task.status}
                            today={today}
                          />
                        ) : (
                          <span className="text-[12.5px] text-[var(--ink-400)]">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {visibleTasks.length > PAGE_SIZE ? (
        <div className="mt-4 flex justify-end">
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("prevPageAria")}
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeftIcon aria-hidden className="size-4" />
                </Button>
              </PaginationItem>
              {pageItems(currentPage, pageCount).map((item) =>
                typeof item === "number" ? (
                  <PaginationItem key={item}>
                    <Button
                      variant={item === currentPage ? "outline" : "ghost"}
                      size="icon"
                      className="size-8"
                      aria-current={item === currentPage ? "page" : undefined}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("nextPageAria")}
                  disabled={currentPage === pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRightIcon aria-hidden className="size-4" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}

      <NewTeamTaskModal
        open={newTaskOpen}
        teamId={teamId}
        projects={projects}
        defaultProjectId={projectId}
        members={members}
        defaultAssigneeId={actorId}
        onSuccess={() => {
          setNewTaskOpen(false);
          router.refresh();
        }}
        onCancel={() => setNewTaskOpen(false)}
      />
    </>
  );
}
