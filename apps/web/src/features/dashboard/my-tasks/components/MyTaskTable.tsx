import { getTaskProgress } from "@open-doing/types";
import Link from "next/link";

import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";

import type { MyTaskListItem } from "../service";

/** 「我的任务」列表段入参。 */
export interface MyTaskTableProps {
  /** 段标题：「个人任务」/「我负责的团队任务」。 */
  title: string;
  /** 本段任务（服务端已按截止日期升序、无日期最后排序）。 */
  tasks: MyTaskListItem[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），用于逾期 / 临期判定。 */
  today: string;
  /** 项目 chip 是否带团队名前缀（团队任务段）。 */
  showTeamName?: boolean;
  /** 标题行右侧的说明文案。 */
  hint?: string;
  /** 空段标题。 */
  emptyTitle: string;
  /** 空段说明。 */
  emptyDescription: string;
}

/**
 * 用「子任务计数」还原 `getTaskProgress` 需要的入参。
 *
 * 列表查询只带计数（避免 N+1），而进度口径统一收敛在纯函数
 * `getTaskProgress` 中：有子任务 = 完成数 / 总数，无子任务按状态
 * 0 / 0.5 / 1。这里按计数构造等长布尔数组，保持口径唯一。
 */
function taskProgress(task: MyTaskListItem): number {
  return getTaskProgress({
    status: task.status,
    subtasks: Array.from({ length: task.subtaskCount }, (_, index) => ({
      completed: index < task.completedSubtaskCount,
    })),
  });
}

/** 项目 chip：个人无项目显示「不属于项目」，团队段带团队名前缀。 */
function ProjectChip({
  task,
  showTeamName,
}: {
  task: MyTaskListItem;
  showTeamName: boolean;
}) {
  const label =
    showTeamName && task.teamName && task.projectName
      ? `${task.teamName} / ${task.projectName}`
      : (task.projectName ?? "不属于项目");

  return (
    <span
      title={label}
      className="inline-flex max-w-[240px] items-center truncate rounded-md bg-[#f4f5f7] px-2 py-0.5 text-[12px] text-[#5f6368]"
    >
      {label}
    </span>
  );
}

/** 单行进度：已完成显示「—」；有子任务显示进度条与计数；否则按状态计。 */
function TaskProgress({ task }: { task: MyTaskListItem }) {
  if (task.status === "done") {
    return <span className="text-[12.5px] text-[#9aa0a6]">—</span>;
  }

  const progress = taskProgress(task);
  const percent = Math.round(progress * 100);

  if (task.subtaskCount === 0) {
    return (
      <span className="whitespace-nowrap text-[12px] text-[#9aa0a6]">
        无子任务，按状态计 {percent}%
      </span>
    );
  }

  return (
    <div>
      <div className="mb-1 w-[110px]">
        <ProgressBar value={progress} />
      </div>
      <span className="whitespace-nowrap text-[12px] text-[#9aa0a6]">
        {task.completedSubtaskCount}/{task.subtaskCount} 子任务 · {percent}%
      </span>
    </div>
  );
}

/**
 * 「我的任务」列表段（纯服务端表格）。
 *
 * 5 列：任务 / 项目 / 状态 / 截止日期 / 进度；已完成行置灰 + 标题删除线。
 * 窄屏（含 375px）时表格在卡片内横向滚动，页面本身不横向溢出。
 */
export function MyTaskTable({
  title,
  tasks,
  today,
  showTeamName = false,
  hint,
  emptyTitle,
  emptyDescription,
}: MyTaskTableProps) {
  return (
    <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white px-4 py-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:px-5">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-[#0e1318]">{title}</h2>
        <span className="rounded-full bg-[#f4f5f7] px-2 py-0.5 text-[12px] font-medium text-[#5f6368]">
          {tasks.length}
        </span>
        {hint ? (
          <span className="ml-auto text-[12px] text-[#9aa0a6]">{hint}</span>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        // 窄屏：表格在卡片内横向滚动，页面本身不横向溢出。
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13.5px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {["任务", "项目", "状态", "截止日期", "进度"].map((label) => (
                  <th
                    key={label}
                    className="border-b border-[#e1e3e6] px-3 pb-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9aa0a6]"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child_td]:border-b-0">
              {tasks.map((task) => {
                const done = task.status === "done";

                return (
                  <tr
                    key={task.id}
                    className={`transition-colors hover:bg-[#f4f5f7] ${
                      done ? "opacity-[0.62]" : ""
                    }`}
                  >
                    <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                      <Link
                        href={task.href}
                        className={`min-w-0 break-words font-medium ${
                          done
                            ? "text-[#9aa0a6] line-through"
                            : "text-[#0e1318] no-underline hover:underline"
                        }`}
                      >
                        {task.title}
                      </Link>
                    </td>

                    <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                      <ProjectChip task={task} showTeamName={showTeamName} />
                    </td>

                    <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                      <StatusTag status={task.status} />
                    </td>

                    <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                      {task.dueDate ? (
                        <DueText
                          dueDate={task.dueDate}
                          status={task.status}
                          today={today}
                        />
                      ) : (
                        <span className="text-[12.5px] text-[#9aa0a6]">—</span>
                      )}
                    </td>

                    <td className="border-b border-[#e1e3e6] px-3 py-3 align-middle">
                      <TaskProgress task={task} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
