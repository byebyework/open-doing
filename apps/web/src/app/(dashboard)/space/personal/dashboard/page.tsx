import type { Metadata } from "next";

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

export const metadata: Metadata = {
  title: "Dashboard · Open Doing",
};

/**
 * 个人空间 Dashboard。
 *
 * RSC 取数：五项统计 + 「今天」列表（未完成且截止 ≤ 今天，逾期置顶）+
 * 新建任务可选项目；勾选完成的交互下沉到 client 组件。
 * 「今天」口径统一为 Asia/Shanghai，由 `todayInShanghai()` 计算后作为
 * prop 传给 client，保证服务端/客户端渲染一致。
 */
export default async function PersonalDashboardPage() {
  const user = await requireUser();
  const today = todayInShanghai();
  const weekStart = getWeekStart(today);

  const [stats, board, projects] = await Promise.all([
    getMyTaskStats({ userId: user.id, today, weekStart }),
    getTodayBoard({ userId: user.id, today }),
    listCrossSpaceProjects(user.id),
  ]);

  // dueSoon = 今天 + 明天；board.total = 今天 + 逾期。
  // 用这两条精确计数拆出「今日」「明日到期」，避免再扫一次任务表。
  const todayCount = Math.max(board.total - stats.overdue, 0);
  const tomorrowCount = Math.max(stats.dueSoon - todayCount, 0);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            Dashboard
          </h1>
          <p className="mt-1.5 text-[14px] text-[#5f6368]">
            今天要做的、快到期的，以及逾期需要兜底的，都在这里；任务全景看
            Kanban。
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <NewPersonalProjectButton />
          <NewTaskButton projects={projects} />
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-5 min-[861px]:gap-4">
        <StatCard
          label="进行中"
          value={stats.inProgress}
          hint="跨全部空间"
        />
        <StatCard
          label="今日"
          value={todayCount}
          hint="今天到期"
          color="#a66b00"
        />
        <StatCard
          label="明日到期"
          value={tomorrowCount}
          hint="明天到期"
          color="#a66b00"
        />
        <StatCard
          label="已逾期"
          value={stats.overdue}
          hint="建议今天兜底"
          color="#ff5757"
        />
        <StatCard
          label="本周已完成"
          value={stats.doneThisWeek}
          hint={`自本周一（${weekStart.slice(5)}）以来`}
          color="#00b894"
        />
      </div>

      <TodayTaskList tasks={board.tasks} today={today} total={board.total} />

      <div
        className="mt-4 flex gap-2 rounded-lg px-3 py-2.5 text-[12.5px]"
        style={{ background: "rgba(13,153,255,0.1)", color: "#0b6fb8" }}
      >
        <span aria-hidden="true" className="flex-none">
          ℹ
        </span>
        <span>
          列表只保留「今天该看的」：截止早于今天的逾期任务置顶；已勾选完成的任务即从列表消失。想按状态或项目翻看全部任务，去
          Kanban。
        </span>
      </div>
    </div>
  );
}
