import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import type { MilestoneTaskItem } from "@/features/dashboard/team-overview/service";
import { moduleHref } from "@/lib/routes";

import { MilestoneCarousel } from "./MilestoneCarousel";

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
 * 头部与「查看全部」脚注留在服务端；列表本体由客户端
 * `MilestoneCarousel` 承接——横向幻灯片翻页（每页 5 行），卡片高度恒定，
 * 与同排「项目健康度」等高（grid stretch），见 2026-11-18 视觉反馈。
 */
export async function MilestoneList({
  teamSlug,
  tasks,
  today,
}: MilestoneListProps) {
  const t = await getTranslations("dashboard");

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-[var(--border-default)] bg-white p-4 shadow-[var(--shadow-rest)] min-[861px]:p-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-[var(--ink-900)]">
          {t("milestonesTitle")}
        </h2>
        <span className="ml-auto text-[12px] text-[var(--ink-400)]">
          {t("milestonesHint")}
        </span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title={t("emptyMilestonesTitle")}
          description={t("emptyMilestonesDescription")}
        />
      ) : (
        <MilestoneCarousel tasks={tasks} today={today} />
      )}

      <div className="-mx-4 mt-auto border-t border-[var(--border-default)] px-4 pt-2.5 min-[861px]:-mx-5 min-[861px]:px-5">
        <Link
          href={moduleHref(teamSlug, "tasks")}
          className="text-[12.5px] font-medium text-[var(--purple-600)] hover:underline"
        >
          {t("viewAllTasks")}
        </Link>
      </div>
    </section>
  );
}
