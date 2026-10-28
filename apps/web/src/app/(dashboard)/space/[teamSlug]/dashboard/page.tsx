import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DueText } from "@/components/ui/DueText";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { requireUser } from "@/features/auth/session";
import { MemberLoadList } from "@/features/dashboard/team-overview/components/MemberLoadList";
import {
  HEALTH_COLOR_RULES,
  resolveProjectHealthLevel,
} from "@/features/dashboard/team-overview/constants";
import { getTeamOverview } from "@/features/dashboard/team-overview/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { teamProjectHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export const metadata: Metadata = {
  title: "团队概览 · Open Doing",
};

/** 顶部统计卡（只读展示）。 */
function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string | number;
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
 * 团队概览页（D-2/D-3）。
 *
 * 所有成员可进：团队不存在或非成员一律 404（与设置页一致，不泄露存在性）。
 * 页面保持只读：聚合取数后只渲染统计头、项目健康度、风险区、成员负载与
 * 未指派区；没有新建 / 催办 / 改派按钮，改派引导回任务详情。
 * 成员负载的行内下钻是唯一交互，下沉到 client 组件。
 */
export default async function TeamOverviewPage(
  props: PageProps<"/space/[teamSlug]/dashboard">,
) {
  const { teamSlug } = await props.params;
  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const today = todayInShanghai();
  const overview = await getTeamOverview({
    teamId: team.id,
    teamSlug: team.slug,
    today,
  });

  // 概览页只读，仅用于决定未指派区的引导文案（管理员可自行去任务详情改派）。
  const canManage = can(membership.role, "team:manage_projects");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <header className="min-w-0">
        <div className="mb-1 text-[13px] text-[#9aa0a6]">
          {team.name} <span className="mx-1">/</span> 团队概览
        </div>
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          团队概览
        </h1>
        <p className="mt-1.5 text-[14px] text-[#5f6368]">
          项目健康度、风险任务与成员负载，数据自任务自动聚合。
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard
          label="在册项目"
          value={overview.teamStats.projectCount}
          hint="团队全部项目"
        />
        <StatCard
          label="团队整体进度"
          value={`${Math.round(overview.teamStats.avgProgress * 100)}%`}
          hint="按任务等权平均"
          color="#7d2ae8"
        />
        <StatCard
          label="临期任务"
          value={overview.teamStats.dueSoonCount}
          hint="今天 / 明天到期"
          color="#a66b00"
        />
        <StatCard
          label="已逾期"
          value={overview.teamStats.overdueCount}
          hint="请优先处理"
          color="#ff5757"
        />
      </div>

      <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-4 min-[861px]:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-bold text-[#0e1318]">项目健康度</h2>
            <span className="ml-auto text-[12px] text-[#9aa0a6]">
              进度按任务完成度自动聚合
            </span>
          </div>

          {overview.projects.length === 0 ? (
            <EmptyState
              title="暂无项目"
              description="团队创建项目并添加任务后，这里会自动聚合健康度。"
            />
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {overview.projects.map((project) => {
                const level = resolveProjectHealthLevel(
                  project.hasOverdue,
                  project.hasDueSoon,
                );
                const rule = HEALTH_COLOR_RULES[level];
                const percent = Math.round(project.progress * 100);

                return (
                  <li key={project.projectId} className="min-w-0">
                    <Link
                      href={teamProjectHref(team.slug, project.projectSlug)}
                      className="-m-1 block min-w-0 rounded-lg p-1 hover:bg-[#f4f5f7]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-semibold text-[#0e1318]">
                            {project.projectName}
                          </div>
                          <div className="mt-0.5 text-[12px] text-[#9aa0a6]">
                            {project.taskCount} 个任务
                          </div>
                        </div>
                        <span
                          className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium"
                          style={{
                            color: rule.color,
                            background: rule.background,
                          }}
                        >
                          {rule.label}
                        </span>
                        <span
                          className="w-10 shrink-0 text-right text-[12.5px] font-semibold"
                          style={{ color: rule.color }}
                        >
                          {percent}%
                        </span>
                      </div>
                      <div className="mt-2">
                        <ProgressBar value={project.progress} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-bold text-[#0e1318]">风险区</h2>
            <span
              className="ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium"
              style={{
                color: HEALTH_COLOR_RULES.overdue.color,
                background: HEALTH_COLOR_RULES.overdue.background,
              }}
            >
              {overview.teamStats.overdueCount} 逾期
            </span>
            <span
              className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium"
              style={{
                color: HEALTH_COLOR_RULES.dueSoon.color,
                background: HEALTH_COLOR_RULES.dueSoon.background,
              }}
            >
              {overview.teamStats.dueSoonCount} 临期
            </span>
          </div>

          {overview.riskTasks.length === 0 ? (
            <EmptyState
              title="暂无风险任务"
              description="团队没有逾期或临期任务，节奏良好。"
            />
          ) : (
            <ul className="mt-2 flex flex-col">
              {overview.riskTasks.map((task) => (
                <li
                  key={task.id}
                  className="border-t border-[#eceef0] first:border-t-0"
                >
                  <Link
                    href={task.href}
                    className="flex min-w-0 items-start gap-2.5 rounded-md py-2.5 hover:bg-[#f4f5f7]"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background:
                          task.kind === "overdue"
                            ? HEALTH_COLOR_RULES.overdue.color
                            : "#ffb020",
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-[#0e1318]">
                        {task.title}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-[#5f6368]">
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
                        <DueText
                          dueDate={task.dueDate}
                          status="todo"
                          today={today}
                        />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-5 min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold text-[#0e1318]">成员负载</h2>
          <span className="ml-auto text-[12px] text-[#9aa0a6]">
            进行中任务数 · 点击成员查看其项目任务
          </span>
        </div>
        <MemberLoadList members={overview.members} today={today} />
      </section>

      <section className="mt-5 min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold text-[#0e1318]">
            未指派（{overview.unassigned.length}）
          </h2>
          <span className="ml-auto text-[12px] text-[#9aa0a6]">
            仅未完成任务需要重新分配
          </span>
        </div>

        {overview.unassigned.length === 0 ? (
          <EmptyState
            title="没有待指派的团队任务"
            description="所有未完成的团队任务都已指派负责人。"
          />
        ) : (
          <>
            <div className="mt-3 rounded-lg bg-[#eef0fc] px-3 py-2 text-[12.5px] text-[#5f6368]">
              {canManage
                ? "请进入任务详情重新指派负责人；概览页保持只读。"
                : "请联系团队管理员重新指派负责人。"}
            </div>
            <ul className="mt-1 flex flex-col">
              {overview.unassigned.map((task) => (
                <li
                  key={task.id}
                  className="border-t border-[#eceef0] first:border-t-0"
                >
                  <Link
                    href={task.href}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-2.5 hover:bg-[#f4f5f7]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#0e1318]">
                      {task.title}
                    </span>
                    <span className="max-w-[200px] shrink-0 truncate rounded-md bg-[#f4f5f7] px-2 py-0.5 text-[12px] text-[#5f6368]">
                      {task.projectName}
                    </span>
                    <span className="shrink-0">
                      {task.dueDate ? (
                        <DueText
                          dueDate={task.dueDate}
                          status="todo"
                          today={today}
                        />
                      ) : (
                        <span className="whitespace-nowrap text-[12px] text-[#9aa0a6]">
                          无截止日期
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
