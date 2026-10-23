"use client";

import type { TaskStatus } from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import { Button, Select } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";

import { NewTaskModal } from "./NewTaskModal";
import {
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  TaskRowActions,
  type ProjectTask,
} from "./TaskRowActions";

/** 状态筛选值：全部 + 三种状态。 */
type StatusFilter = "all" | TaskStatus;

/** 排序方式（「按截止日期」为默认）。 */
type SortKey = "dueDate" | "status" | "createdAt";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "状态：全部" },
  ...TASK_STATUS_ORDER.map((status) => ({
    value: status,
    label: TASK_STATUS_LABEL[status],
  })),
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "dueDate", label: "排序：按截止日期" },
  { value: "status", label: "按状态" },
  { value: "createdAt", label: "按创建时间" },
];

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
 * 4 列：任务 / 状态 / 进度 / 截止日期，无责任人列；
 * 行进度由客户端 `getTaskProgress({ status, subtasks })` 计算。
 */
export function ProjectTaskTable({
  tasks,
  today,
  projectId,
  projects,
}: ProjectTaskTableProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("dueDate");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const visibleTasks = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? tasks
        : tasks.filter((task) => task.status === statusFilter);

    const comparator =
      sort === "status"
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
        <Select<StatusFilter>
          size="small"
          aria-label="按状态筛选"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
          style={{ width: 120 }}
        />
        <Select<SortKey>
          size="small"
          aria-label="排序方式"
          value={sort}
          onChange={setSort}
          options={SORT_OPTIONS}
          style={{ width: 150 }}
        />
        <span className="ml-auto text-[12.5px] text-[#9aa0a6]">
          共 {visibleTasks.length} 条
        </span>
      </div>

      <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white px-4 py-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:px-5">
        {isEmptyProject ? (
          <EmptyState
            title="暂无任务"
            description="创建第一个任务，开始跟踪你的进展。"
            action={
              <Button type="primary" onClick={() => setNewTaskOpen(true)}>
                ＋ 新建任务
              </Button>
            }
          />
        ) : visibleTasks.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[#9aa0a6]">
            没有符合筛选条件的任务
          </p>
        ) : (
          // 窄屏沿用原型策略：表格在卡片内横向滚动，页面本身不横向溢出。
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr>
                  <th className="border-b border-[#e1e3e6] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9aa0a6]">
                    任务
                  </th>
                  <th className="w-24 border-b border-[#e1e3e6] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9aa0a6]">
                    状态
                  </th>
                  <th className="w-[170px] border-b border-[#e1e3e6] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9aa0a6]">
                    进度
                  </th>
                  <th className="w-[130px] border-b border-[#e1e3e6] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9aa0a6]">
                    截止日期
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
                      <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-1">
                          <Link
                            href={`/my/tasks/${task.id}`}
                            className={`min-w-0 break-words font-medium ${
                              done
                                ? "text-[#9aa0a6] line-through"
                                : "text-[#0e1318] no-underline hover:underline"
                            }`}
                          >
                            {task.title}
                          </Link>
                          <TaskRowActions
                            task={task}
                            onChanged={() => router.refresh()}
                          />
                        </div>
                      </td>

                      <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                        <StatusTag status={task.status} />
                      </td>

                      <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                        {done ? (
                          <span className="text-[12.5px] text-[#9aa0a6]">
                            —
                          </span>
                        ) : task.subtasks.length > 0 ? (
                          <div>
                            <div className="mb-1 w-[110px]">
                              <ProgressBar value={progress} />
                            </div>
                            <span className="text-[12px] text-[#9aa0a6]">
                              {completedCount}/{task.subtasks.length} 子任务 ·{" "}
                              {Math.round(progress * 100)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[#9aa0a6]">
                            无子任务，按状态计 {Math.round(progress * 100)}%
                          </span>
                        )}
                      </td>

                      <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                        {task.dueDate ? (
                          <DueText
                            dueDate={task.dueDate}
                            status={task.status}
                            today={today}
                          />
                        ) : (
                          <span className="text-[12.5px] text-[#9aa0a6]">
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
