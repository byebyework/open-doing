import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { StatCard } from "@/components/ui/StatCard";
import { requireUser } from "@/features/auth/session";
import {
  getMyTaskStats,
  getTodayBoard,
  getWeekStart,
  listCrossSpaceProjects,
} from "@/features/dashboard/my-tasks/service";
import { NewTaskButton } from "@/features/dashboard/my-tasks/components/NewTaskModal";
import { TodayTaskList } from "@/features/dashboard/personal-dashboard/components/TodayTaskList";
import { NewPersonalProjectButton } from "@/features/personal/projects/components/NewPersonalProjectButton";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("dashboardTitle") };
}

/** 两个 `YYYY-MM-DD` 之间的整天数（UTC 毫秒算术，不依赖本地时区）。 */
function daysBetween(later: string, earlier: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };

  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/**
 * 个人空间 Dashboard。
 *
 * RSC 取数：四项统计 + 「今天」列表（未完成且截止 ≤ 今天，逾期置顶）+
 * 新建任务可选项目；勾选完成的交互下沉到 client 组件。
 * 「今天」口径统一为 Asia/Shanghai，由 `todayInShanghai()` 计算后作为
 * prop 传给 client，保证服务端/客户端渲染一致。
 */
export default async function PersonalDashboardPage() {
  const t = await getTranslations("dashboard");
  const tNav = await getTranslations("nav");
  const user = await requireUser();
  const today = todayInShanghai();
  const weekStart = getWeekStart(today);

  const [stats, board, projects] = await Promise.all([
    getMyTaskStats({ userId: user.id, today, weekStart }),
    getTodayBoard({ userId: user.id, today }),
    listCrossSpaceProjects(user.id),
  ]);

  // 「今日 / 明日到期」delta 使用不封顶的统计值：今天列表被 limit 截断，
  // 不能用来计数。dueSoon 是今天 + 明天，dueToday 是其中的今天部分。
  const tomorrowCount = Math.max(stats.dueSoon - stats.dueToday, 0);

  // 已逾期 delta 取今天列表里最久的一项（服务端已按截止日期升序）。
  const maxOverdueDays = board.tasks.reduce((max, task) => {
    if (task.dueDate === null || task.dueDate >= today) return max;
    return Math.max(max, daysBetween(today, task.dueDate));
  }, 0);
  const overdueHint =
    stats.overdue > 0
      ? t("overdueHintDays", { days: maxOverdueDays })
      : t("overdueHintNone");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            {tNav("dashboard")}
          </h1>
          <p className="mt-1.5 text-[14px] text-[#5f6368]">
            {t("personalSubtitle")}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <NewPersonalProjectButton />
          <NewTaskButton projects={projects} />
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard
          label={t("statInProgress")}
          value={stats.inProgress}
          hint={t("statInProgressHint", {
            personal: stats.inProgressPersonal,
            team: stats.inProgressTeam,
          })}
        />
        <StatCard
          label={t("statDueSoon")}
          value={stats.dueSoon}
          hint={t("statDueSoonHint", {
            today: stats.dueToday,
            tomorrow: tomorrowCount,
          })}
          color="#a66b00"
        />
        <StatCard
          label={t("statOverdue")}
          value={stats.overdue}
          hint={overdueHint}
          color="#ff5757"
        />
        <StatCard
          label={t("statDoneThisWeek")}
          value={stats.doneThisWeek}
          hint={t("statDoneThisWeekHint", { date: weekStart.slice(5) })}
          color="#00b894"
        />
      </div>

      <TodayTaskList
        tasks={board.tasks}
        today={today}
        total={board.total}
        overdueCount={stats.overdue}
        todayCount={stats.dueToday}
      />

      <div
        className="mt-4 flex gap-2 rounded-lg px-3 py-2.5 text-[12.5px]"
        style={{ background: "rgba(13,153,255,0.1)", color: "#0b6fb8" }}
      >
        <span aria-hidden="true" className="flex-none">
          ℹ
        </span>
        <span>{t("listCallout")}</span>
      </div>
    </div>
  );
}
