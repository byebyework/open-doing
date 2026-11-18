"use client";

/**
 * 重要节点横向翻页轮播（幻灯片交互）。
 *
 * 结构与分页：
 * - 每页 5 行、视口固定高（约 5 行），末页不足留白——卡片高度恒定，
 *   与同排「项目健康度」等高；
 * - 所有页常驻一条横向 track（flex w-full，每页 w-full flex-none），
 *   `animate={{ x: -page * 100% }}` 平移换页：无 AnimatePresence 卸载
 *   竞态，拖拽释放后 animate 目标自动回弹；
 * - 拖拽：`drag="x"` + 零宽约束（橡皮筋），释放时位移/速度过阈值即换页；
 * - 动效：280ms OD_EASE.standard；`MotionConfig reducedMotion="user"` 下
 *   x 变换自动降级为瞬时切换；
 * - 单页（≤5 条）时隐藏翻页控件，仅保留固定视口。
 *
 * 纯客户端：tasks/today 由服务端 MilestoneList 以可序列化 props 传入。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Link from "next/link";

import { OD_EASE, OD_MS } from "@/components/ui/overlay-motion";
import type { MilestoneTaskItem } from "@/features/dashboard/team-overview/service";
import { formatTaskDate } from "@/lib/date-display";

/** 三态节点的原型配色与图标。 */
const KIND_META = {
  overdue: {
    icon: "⏰",
    color: "var(--status-overdue)",
    background: "var(--status-overdue-bg)",
  },
  dueSoon: {
    icon: "⏳",
    color: "#a66b00",
    background: "var(--status-due-soon-bg)",
  },
  upcoming: {
    icon: "📅",
    color: "var(--ink-500)",
    background: "#e8eaed",
  },
} as const;

/** 两个 `YYYY-MM-DD` 之间的整天数（UTC 毫秒算术，不依赖本地时区）。 */
function daysBetween(later: string, earlier: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };

  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/** 每页行数；视口高度按 5 × 62px 行高取 311px。 */
const PAGE_SIZE = 5;
const VIEWPORT_HEIGHT = 311;

/** 换页手势阈值：水平位移（px）或速度（px/s）任一越过即翻页。 */
const DRAG_OFFSET_THRESHOLD = 60;
const DRAG_VELOCITY_THRESHOLD = 300;

/** 换页滑动：入场自滑动方向平移进入，退场反向滑出。 */
const slideTransition = {
  duration: OD_MS.popIn / 1000,
  ease: OD_EASE.standard,
};

export function MilestoneCarousel({
  tasks,
  today,
}: {
  tasks: MilestoneTaskItem[];
  today: string;
}) {
  const t = useTranslations("dashboard");
  const tTasks = useTranslations("tasks");

  const pageCount = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  const clamped = Math.min(page, pageCount - 1);

  const paginate = (delta: number) => {
    setPage((current) => Math.min(Math.max(current + delta, 0), pageCount - 1));
  };
  const goTo = (index: number) => setPage(index);

  const pages = Array.from({ length: pageCount }, (_, index) =>
    tasks.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
  );

  return (
    <div className="mt-1 min-w-0">
      <div
        className="overflow-hidden"
        style={{ height: VIEWPORT_HEIGHT }}
        aria-live="polite"
      >
        <motion.div
          className="flex w-full flex-none"
          animate={{ x: `-${clamped * 100}%` }}
          transition={slideTransition}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.35}
          onDragEnd={(_event, info) => {
            if (info.offset.x < -DRAG_OFFSET_THRESHOLD || info.velocity.x < -DRAG_VELOCITY_THRESHOLD) {
              paginate(1);
            } else if (
              info.offset.x > DRAG_OFFSET_THRESHOLD ||
              info.velocity.x > DRAG_VELOCITY_THRESHOLD
            ) {
              paginate(-1);
            }
          }}
        >
          {pages.map((pageTasks, pageIndex) => (
            <div
              key={pageIndex}
              data-slot="milestone-page"
              data-current={pageIndex === clamped ? "true" : "false"}
              className="w-full flex-none px-px"
            >
              {pageTasks.map((task) => {
                const meta = KIND_META[task.kind];
                const overdueDays =
                  task.kind === "overdue" ? daysBetween(today, task.dueDate) : 0;

                return (
                  <div
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
                        <div className="truncate text-[13.5px] font-semibold leading-[1.35] text-[var(--ink-900)]">
                          {task.title}
                        </div>
                        <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-1 text-[12px] text-[var(--ink-500)]">
                          <span className="max-w-full truncate">
                            {task.projectName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              task.assigneeName ? undefined : "text-[#a66b00]"
                            }
                          >
                            {task.assigneeName ?? tTasks("unassigned")}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="whitespace-nowrap" title={task.dueDate}>
                            {task.kind === "overdue"
                              ? t("dueOverdueLine", {
                                  date: formatTaskDate(task.dueDate),
                                  days: overdueDays,
                                })
                              : t("dueLine", { date: formatTaskDate(task.dueDate) })}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </motion.div>
      </div>

      {pageCount > 1 ? (
        <nav
          aria-label={t("milestonesPagerLabel")}
          className="mt-1 flex items-center justify-center gap-2"
        >
          <button
            type="button"
            data-slot="milestone-prev"
            aria-label={t("milestonesPrevPage")}
            disabled={clamped === 0}
            onClick={() => paginate(-1)}
            className="grid size-7 place-items-center rounded-lg text-[var(--ink-500)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              data-slot="milestone-dot"
              aria-label={t("milestonesGoToPage", { page: index + 1 })}
              aria-current={index === clamped ? "true" : undefined}
              onClick={() => goTo(index)}
              className="group p-1"
            >
              <i
                className={`block size-1.5 rounded-full transition-colors ${
                  index === clamped
                    ? "bg-[var(--purple-600)]"
                    : "bg-[var(--border-strong)] group-hover:bg-[var(--ink-400)]"
                }`}
                aria-hidden="true"
              />
            </button>
          ))}
          <button
            type="button"
            data-slot="milestone-next"
            aria-label={t("milestonesNextPage")}
            disabled={clamped === pageCount - 1}
            onClick={() => paginate(1)}
            className="grid size-7 place-items-center rounded-lg text-[var(--ink-500)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
