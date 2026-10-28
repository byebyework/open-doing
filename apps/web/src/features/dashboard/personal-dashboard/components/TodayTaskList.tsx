"use client";

import { Checkbox, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import type { MyTaskListItem } from "@/features/dashboard/my-tasks/service";
import { updatePersonalTaskAction } from "@/features/personal/tasks/actions";
import { updateTeamTaskAction } from "@/features/tasks/actions";
import { moduleHref } from "@/lib/routes";

/** TodayTaskList 入参。 */
export interface TodayTaskListProps {
  /** 未完成且截止 ≤ 今天（服务端已按截止日期升序）。 */
  tasks: MyTaskListItem[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），由 RSC 传入以保证判定一致。 */
  today: string;
  /** 同条件全量任务数；大于 `tasks.length` 时展示页脚。 */
  total: number;
  /** 全量逾期数（不封顶，来自 getMyTaskStats）。 */
  overdueCount: number;
  /** 全量今天到期数（不封顶，来自 getMyTaskStats）。 */
  todayCount: number;
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 将 `YYYY-MM-DD` 显示为原型同款 `MM-DD`。 */
function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

/** 两个 `YYYY-MM-DD` 之间的整天数（UTC 毫秒算术，不依赖本地时区）。 */
function daysBetween(later: string, earlier: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };

  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/** 卡片头日期：「今天 · 10 月 21 日 周三」。 */
function formatHeaderDate(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday =
    WEEKDAY_LABELS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()];

  return `今天 · ${month} 月 ${day} 日 ${weekday}`;
}

/** 来源标签：团队任务品牌紫浅底 / 个人任务薄荷浅底（原型 tag 配色）。 */
function SourceTag({ task }: { task: MyTaskListItem }) {
  const isTeam = task.spaceType === "team";

  const label = isTeam
    ? task.projectName
      ? `团队 · ${task.projectName}`
      : "团队"
    : task.projectName
      ? `个人 · ${task.projectName}`
      : "个人";

  return (
    <span
      className="inline-flex max-w-[240px] items-center truncate rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={
        isTeam
          ? { background: "rgba(155,135,245,0.14)", color: "#6d4fd4" }
          : { background: "rgba(72,201,151,0.12)", color: "#48c997" }
      }
    >
      {label}
    </span>
  );
}

/** 右侧截止文案：逾期红「截止 MM-DD · 已逾期 N 天」/ 今天 warning「今天到期」。 */
function DueLabel({
  dueDate,
  today,
}: {
  dueDate: string | null;
  today: string;
}) {
  if (!dueDate) return null;

  if (dueDate < today) {
    return (
      <span
        className="whitespace-nowrap text-[12.5px] font-semibold text-[#ff5757]"
        title={dueDate}
      >
        截止 {shortDate(dueDate)} · 已逾期 {daysBetween(today, dueDate)} 天
      </span>
    );
  }

  return (
    <span
      className="whitespace-nowrap text-[12.5px] font-semibold text-[#a66b00]"
      title={dueDate}
    >
      今天到期
    </span>
  );
}

/**
 * 个人 Dashboard「今天」任务列表（client）。
 *
 * 勾选完成采用乐观更新：本地立即置为完成（划线淡出），再调用对应空间的
 * Server Action；失败回滚并提示。成功后 `router.refresh()` 让 RSC 重新取数，
 * 已完成任务自然从列表中消失。服务端刷新后以最新 props 为准
 * （渲染期同步 props → state，避免 effect 多跑一轮）。
 */
export function TodayTaskList({
  tasks,
  today,
  total,
  overdueCount,
  todayCount,
}: TodayTaskListProps) {
  const router = useRouter();
  const [syncedTasks, setSyncedTasks] = useState(tasks);
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // props 变化（router.refresh 后）即重置本地乐观状态。
  if (tasks !== syncedTasks) {
    setSyncedTasks(tasks);
    setDoneIds(new Set<string>());
  }

  function restore(id: string) {
    setDoneIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }

  async function completeTask(task: MyTaskListItem) {
    if (doneIds.has(task.id)) return;

    // 乐观更新：先划线淡出，失败再回滚。
    setDoneIds((previous) => new Set(previous).add(task.id));

    try {
      let ok = false;

      if (task.spaceType === "team") {
        if (task.teamId) {
          const result = await updateTeamTaskAction(task.id, {
            teamId: task.teamId,
            status: "done",
          });
          ok = result.ok;
        }
      } else {
        const result = await updatePersonalTaskAction(task.id, {
          status: "done",
        });
        ok = result.ok;
      }

      if (!ok) {
        restore(task.id);
        message.error("更新失败，请重试");
        return;
      }

      router.refresh();
    } catch {
      restore(task.id);
      message.error("更新失败，请重试");
    }
  }

  return (
    <section className="mt-5 min-w-0 rounded-xl border border-[#e1e3e6] bg-white shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-2 pt-4 min-[861px]:px-5">
        <h2 className="text-[15px] font-bold text-[#0e1318]">
          {formatHeaderDate(today)}
        </h2>
        <span
          className="ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium"
          style={{ background: "rgba(255,87,87,0.1)", color: "#ff5757" }}
        >
          {overdueCount} 逾期
        </span>
        <span
          className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium"
          style={{ background: "rgba(255,176,32,0.12)", color: "#a66b00" }}
        >
          {todayCount} 今天
        </span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="今天没有到期或逾期的任务"
          description="可以安心推进进行中的任务，或去 Kanban 查看任务全景。"
        />
      ) : (
        <ul className="px-4 min-[861px]:px-5">
          {tasks.map((task) => {
            const done = doneIds.has(task.id);

            return (
              <li
                key={task.id}
                className="border-t border-[#eceef0] first:border-t-0"
              >
                <div
                  className={`flex min-w-0 items-start gap-3 py-3 transition-opacity ${
                    done ? "opacity-60" : ""
                  }`}
                >
                  <Checkbox
                    aria-label={`标记完成：${task.title}`}
                    checked={done}
                    disabled={done}
                    onChange={() => {
                      void completeTask(task);
                    }}
                    className="mt-0.5 shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      href={task.href}
                      className={`block break-words text-[13.5px] font-medium ${
                        done
                          ? "text-[#9aa0a6] line-through"
                          : "text-[#0e1318] no-underline hover:underline"
                      }`}
                    >
                      {task.title}
                    </Link>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-[#5f6368]">
                      <SourceTag task={task} />
                      <span>我</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <DueLabel dueDate={task.dueDate} today={today} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {total > tasks.length ? (
        <div className="border-t border-[#e1e3e6] px-4 py-3 min-[861px]:px-5">
          <Link
            href={moduleHref("personal", "kanban")}
            className="text-[12.5px] text-[#7d2ae8] no-underline hover:underline"
          >
            还有 {total - tasks.length} 项未完成任务（含未来截止）· 前往 Kanban
            查看全部 →
          </Link>
        </div>
      ) : null}
    </section>
  );
}
