import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import type { MilestoneTaskItem } from "@/features/dashboard/team-overview/service";
import { moduleHref } from "@/lib/routes";

/** 三态节点的原型配色与图标。 */
const KIND_META = {
  overdue: {
    icon: "⏰",
    color: "#ff5757",
    background: "rgba(255,87,87,0.1)",
  },
  dueSoon: {
    icon: "⏳",
    color: "#a66b00",
    background: "rgba(255,176,32,0.12)",
  },
  upcoming: {
    icon: "📅",
    color: "#9aa0a6",
    background: "#f4f5f7",
  },
} as const;

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

/** 重要节点列表入参。 */
export interface MilestoneListProps {
  /** 团队 slug，用于拼 Kanban 链接。 */
  teamSlug: string;
  /** 未完成任务（服务端已按截止日期升序、封顶 10 条）。 */
  tasks: MilestoneTaskItem[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`），用于计算逾期天数。 */
  today: string;
}

/**
 * 团队 Dashboard「重要节点」（server，纯渲染）。
 *
 * 行内展示任务标题与「项目 · 责任人 · 截止日期」；逾期行追加逾期天数。
 * 行内链接直达任务详情，卡片尾部引导到空间级 Kanban 看全部任务。
 */
export function MilestoneList({ teamSlug, tasks, today }: MilestoneListProps) {
  return (
    <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-[#0e1318]">重要节点</h2>
        <span className="ml-auto text-[12px] text-[#9aa0a6]">
          未完成任务 · 按截止日期升序
        </span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="暂无重要节点"
          description="团队未完成任务设置了截止日期后，这里会自动按日期排序。"
        />
      ) : (
        <ul className="mt-1 flex flex-col">
          {tasks.map((task) => {
            const meta = KIND_META[task.kind];
            const overdueDays =
              task.kind === "overdue" ? daysBetween(today, task.dueDate) : 0;

            return (
              <li
                key={task.id}
                className="border-t border-[#eceef0] first:border-t-0"
              >
                <Link
                  href={task.href}
                  className="flex min-w-0 items-start gap-2.5 rounded-md py-[11px] hover:bg-[#f4f5f7]"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 flex-none place-items-center rounded-lg text-[14px]"
                    style={{ background: meta.background, color: meta.color }}
                  >
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold leading-[1.35] text-[#0e1318]">
                      {task.title}
                    </div>
                    <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-1 text-[12px] text-[#9aa0a6]">
                      <span className="max-w-full truncate">
                        {task.projectName}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          task.assigneeName ? undefined : "text-[#a66b00]"
                        }
                      >
                        {task.assigneeName ?? "未指派"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="whitespace-nowrap" title={task.dueDate}>
                        截止 {shortDate(task.dueDate)}
                        {task.kind === "overdue"
                          ? `，已逾期 ${overdueDays} 天`
                          : ""}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="-mx-4 mt-1 border-t border-[#eceef0] px-4 pt-2.5 min-[861px]:-mx-5 min-[861px]:px-5">
        <Link
          href={moduleHref(teamSlug, "kanban")}
          className="text-[12.5px] font-medium text-[#7d2ae8] hover:underline"
        >
          查看全部任务 · 前往 Kanban →
        </Link>
      </div>
    </section>
  );
}
