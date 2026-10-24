import { requireUser } from "@/features/auth/session";
import {
  getMyTaskStats,
  getWeekStart,
  listCrossSpaceProjects,
  listMyPersonalTasks,
  listMyTeamTasks,
} from "@/features/dashboard/my-tasks/service";
import { MyTaskTable } from "@/features/dashboard/my-tasks/components/MyTaskTable";
import { NewTaskButton } from "@/features/dashboard/my-tasks/components/NewTaskModal";
// `todayInShanghai` 与 `features/notifications/due-scan.ts` 的 `shanghaiToday`
// 采用同一口径（Intl en-CA + Asia/Shanghai）；这里复用 lib 中已有实现，
// 不再复制一份。
import { todayInShanghai } from "@/lib/today";

/** 顶部统计卡入参。 */
function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: number;
  hint: string;
  color?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
      <div className="text-[12.5px] text-[#5f6368]">{label}</div>
      <div
        className="mt-1 text-[28px] font-bold leading-none tracking-[-0.01em] text-[#0e1318]"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[#9aa0a6]">{hint}</div>
    </div>
  );
}

/**
 * 「我的任务」页（D-1）：跨空间聚合的只读总览。
 *
 * RSC 取数：统计四项 + 个人任务列表 + 跨团队任务列表 + 新建任务可选项目；
 * 新建任务弹窗作为唯一交互件下沉到 client 组件。列表排序、逾期/临期判定
 * 的日期口径统一为 Asia/Shanghai 的今天。
 */
export default async function MyTasksPage() {
  const user = await requireUser();
  const today = todayInShanghai();
  const weekStart = getWeekStart(today);

  const [stats, personalTasks, teamTasks, projects] = await Promise.all([
    getMyTaskStats({ userId: user.id, today, weekStart }),
    listMyPersonalTasks(user.id),
    listMyTeamTasks(user.id),
    listCrossSpaceProjects(user.id),
  ]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            我的任务
          </h1>
          <p className="mt-1.5 text-[14px] text-[#5f6368]">
            个人任务，以及各团队项目中分配给你的任务。
          </p>
        </div>
        <NewTaskButton projects={projects} />
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard label="进行中" value={stats.inProgress} hint="跨全部空间" />
        <StatCard
          label="今日 / 明日到期"
          value={stats.dueSoon}
          hint="建议优先处理"
          color="#a66b00"
        />
        <StatCard
          label="已逾期"
          value={stats.overdue}
          hint="请尽快处理"
          color="#ff5757"
        />
        <StatCard
          label="本周已完成"
          value={stats.doneThisWeek}
          hint="自本周一以来"
          color="#00b894"
        />
      </div>

      <div className="mt-6 flex flex-col gap-5">
        <MyTaskTable
          title="个人任务"
          tasks={personalTasks}
          today={today}
          emptyTitle="暂无个人任务"
          emptyDescription="创建第一个任务，或把它归入个人项目。"
        />

        <MyTaskTable
          title="我负责的团队任务"
          tasks={teamTasks}
          today={today}
          showTeamName
          hint="跨团队按责任人聚合 · 按截止日期排序"
          emptyTitle="暂无团队任务"
          emptyDescription="当你被指派团队任务后，会在这里跨团队汇总展示。"
        />
      </div>
    </div>
  );
}
