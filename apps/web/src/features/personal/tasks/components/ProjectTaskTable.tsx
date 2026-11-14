"use client";

import type { TaskStatus } from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { PriorityChip } from "@/components/ui/PriorityChip";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { compareByPriority } from "@/lib/task-sort";
import { personalTaskHref } from "@/lib/routes";

import { NewTaskModal } from "./NewTaskModal";
import {
  TASK_STATUS_KEYS,
  TASK_STATUS_ORDER,
  TaskRowActions,
  TaskStatusMenu,
  type ProjectTask,
} from "./TaskRowActions";

/** 状态筛选值：全部 + 三种状态。 */
type StatusFilter = "all" | TaskStatus;

/** 排序方式（「按截止日期」为默认）。 */
type SortKey = "dueDate" | "priority" | "status" | "createdAt";

/** 无截止日期的任务排在最后。 */
const NO_DUE_DATE = "9999-12-31";

const STATUS_WEIGHT: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
};

function compareByDueDate(a: ProjectTask, b: ProjectTask): number {
  return (
    (a.dueDate ?? NO_DUE_DATE).localeCompare(b.dueDate ?? NO_DUE_DATE) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function compareByStatus(a: ProjectTask, b: ProjectTask): number {
  return (
    STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
    compareByDueDate(a, b)
  );
}

function compareByCreatedAt(a: ProjectTask, b: ProjectTask): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** 列表视图入参。 */
export interface ProjectTaskTableProps {
  /** 项目全部任务（按创建时间升序）。 */
  tasks: ProjectTask[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），用于逾期 / 临期判定。 */
  today: string;
  /** 当前项目 ID（新建任务默认选中）。 */
  projectId: string;
  /** 新建任务弹窗可选的全部个人项目。 */
  projects: { id: string; name: string }[];
}

/**
 * 个人项目列表视图（对照 `personal-project.html` 表格）。
 *
 * 6 列：任务 / 优先级 / 状态 / 进度 / 截止日期 / 操作，无责任人列；
 * 行进度由客户端 `getTaskProgress({ status, subtasks })` 计算。
 */
export function ProjectTaskTable({
  tasks,
  today,
  projectId,
  projects,
}: ProjectTaskTableProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("dueDate");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const visibleTasks = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? tasks
        : tasks.filter((task) => task.status === statusFilter);

    const comparator =
      sort === "priority"
        ? compareByPriority
        : sort === "status"
          ? compareByStatus
          : sort === "createdAt"
            ? compareByCreatedAt
            : compareByDueDate;

    return [...filtered].sort(comparator);
  }, [tasks, statusFilter, sort]);

  const isEmptyProject = tasks.length === 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger
            className="h-8 w-[120px]"
            aria-label={t("filterByStatusAria")}
            data-testid="task-status-filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAllStatus")}</SelectItem>
            {TASK_STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {tStatus(TASK_STATUS_KEYS[status])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(value) => setSort(value as SortKey)}
        >
          <SelectTrigger
            className="h-8 w-[150px]"
            aria-label={t("sortByAria")}
            data-testid="task-sort-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dueDate">{t("sortDueDate")}</SelectItem>
            <SelectItem value="priority">{t("sortPriority")}</SelectItem>
            <SelectItem value="status">{t("sortStatus")}</SelectItem>
            <SelectItem value="createdAt">{t("sortCreatedAt")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[12.5px] text-[var(--ink-400)]">
          {t("totalCount", { count: visibleTasks.length })}
        </span>
      </div>

      <section className="min-w-0 rounded-xl border border-[var(--border-default)] bg-white px-4 py-4 shadow-[var(--shadow-rest)] min-[861px]:px-5">
        {isEmptyProject ? (
          <EmptyState
            title={t("emptyTasksTitle")}
            description={t("emptyTasksPersonalHint")}
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
          // 窄屏沿用原型策略：表格在卡片内横向滚动，页面本身不横向溢出。
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr>
                  <th className="border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]">
                    {t("colTask")}
                  </th>
                  <th className="w-[72px] border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]">
                    {t("priority")}
                  </th>
                  <th className="w-24 border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]">
                    {t("statusLabel")}
                  </th>
                  <th className="w-[170px] border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]">
                    {t("colProgress")}
                  </th>
                  <th className="w-[130px] border-b border-[var(--border-default)] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]">
                    {t("dueDateLabel")}
                  </th>
                  <th className="w-[88px] border-b border-[var(--border-default)] px-3 pb-3 text-center text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ink-400)]">
                    {t("opsColumn")}
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child_td]:border-b-0">
                {visibleTasks.map((task) => {
                  const done = task.status === "done";
                  const progress = getTaskProgress({
                    status: task.status,
                    subtasks: task.subtasks,
                  });
                  const completedCount = task.subtasks.filter(
                    (subtask) => subtask.completed,
                  ).length;

                  return (
                    <tr
                      key={task.id}
                      className={`transition-colors hover:bg-[#f4f5f7] ${
                        done ? "opacity-[0.62]" : ""
                      }`}
                    >
                      {/* 标题列限宽 + 单行省略：无空格长串不再撑出横向滚动（2026-11-14） */}
                      <td className="w-[40%] max-w-0 border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        <Link
                          href={personalTaskHref(task.id)}
                          className={`block truncate font-medium ${
                            done
                              ? "text-[var(--ink-400)] line-through"
                              : "text-[var(--ink-900)] no-underline hover:underline"
                          }`}
                        >
                          {task.title}
                        </Link>
                      </td>

                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        <PriorityChip priority={task.priority} />
                      </td>

                      <td className="border-b border-[var(--border-default)] px-3 py-3 align-middle">
                        <TaskStatusMenu
                          task={task}
                          onChanged={() => router.refresh()}
                        />
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

                      <td className="border-b border-[var(--border-default)] px-3 py-3 text-center align-middle">
                        <TaskRowActions
                          task={task}
                          onChanged={() => router.refresh()}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewTaskModal
        open={newTaskOpen}
        projects={projects}
        defaultProjectId={projectId}
        onSuccess={() => {
          setNewTaskOpen(false);
          router.refresh();
        }}
        onCancel={() => setNewTaskOpen(false)}
      />
    </>
  );
}
