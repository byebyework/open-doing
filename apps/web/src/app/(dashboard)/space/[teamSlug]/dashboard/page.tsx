import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatCard } from "@/components/ui/StatCard";
import { requireUser } from "@/features/auth/session";
import { MemberLoadList } from "@/features/dashboard/team-overview/components/MemberLoadList";
import {
  HEALTH_COLOR_RULES,
  HEALTH_LABEL_KEYS,
  resolveProjectHealthLevel,
} from "@/features/dashboard/team-overview/constants";
import { getTeamOverview } from "@/features/dashboard/team-overview/service";
import { MilestoneList } from "@/features/dashboard/team-dashboard/components/MilestoneList";
import { getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { moduleHref, teamProjectHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/dashboard">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("meta");

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: t("dashboardTitle") };

  return { title: t("teamModuleTitle", { team: team.name, module: "Dashboard" }) };
}

/**
 * 团队 Dashboard（D-2/D-3）。
 *
 * 所有成员可进：团队不存在或非成员一律 404（与设置页一致，不泄露存在性）。
 * 页面保持只读：项目健康度 + 重要节点双栏，下方成员负载；
 * 未指派任务只保留一行 info callout，完整列表与指派引导在 Kanban。
 * 成员负载的行内下钻是唯一交互，下沉到 client 组件。
 */
export default async function TeamDashboardPage(
  props: PageProps<"/space/[teamSlug]/dashboard">,
) {
  const { teamSlug } = await props.params;
  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const t = await getTranslations("dashboard");
  const today = todayInShanghai();
  const overview = await getTeamOverview({
    teamId: team.id,
    teamSlug: team.slug,
    today,
  });

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <header className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          Dashboard
        </h1>
        <p className="mt-1.5 text-[14px] text-[#5f6368]">
          {t("teamSubtitle")}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4 min-[861px]:gap-4">
        <StatCard
          label={t("statProjects")}
          value={overview.teamStats.projectCount}
          hint={t("statProjectsHint")}
        />
        <StatCard
          label={t("statOverallProgress")}
          value={`${Math.round(overview.teamStats.avgProgress * 100)}%`}
          hint={t("statOverallProgressHint")}
          color="#7d2ae8"
        />
        <StatCard
          label={t("statDueSoonTasks")}
          value={overview.teamStats.dueSoonCount}
          hint={t("statDueSoonTasksHint")}
          color="#a66b00"
        />
        <StatCard
          label={t("statOverdue")}
          value={overview.teamStats.overdueCount}
          hint={t("statOverdueTasksHint")}
          color="#ff5757"
        />
      </div>

      <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-4 min-[861px]:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-bold text-[#0e1318]">
              {t("healthTitle")}
            </h2>
            <span className="ml-auto text-[12px] text-[#9aa0a6]">
              {t("healthHint")}
            </span>
          </div>

          {overview.projects.length === 0 ? (
            <EmptyState
              title={t("emptyProjectsTitle")}
              description={t("emptyProjectsDescription")}
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
                            {t("taskCount", { count: project.taskCount })}
                          </div>
                        </div>
                        <span
                          className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium"
                          style={{
                            color: rule.color,
                            background: rule.background,
                          }}
                        >
                          {t(HEALTH_LABEL_KEYS[level])}
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

        <MilestoneList
          teamSlug={team.slug}
          tasks={overview.milestoneTasks}
          today={today}
        />
      </div>

      <section className="mt-5 min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold text-[#0e1318]">
            {t("memberLoadTitle")}
          </h2>
          <span className="ml-auto text-[12px] text-[#9aa0a6]">
            {t("memberLoadHint")}
          </span>
        </div>
        <MemberLoadList members={overview.members} today={today} />

        <div
          className="mt-3 flex gap-2 rounded-lg px-3 py-2.5 text-[12.5px]"
          style={{ background: "rgba(13,153,255,0.1)", color: "#0b6fb8" }}
        >
          <span aria-hidden="true" className="flex-none">
            ℹ
          </span>
          <span>
            {t("unassignedCallout", {
              count: overview.unassigned.length,
              link: "Kanban",
            })}
          </span>
        </div>
      </section>
    </div>
  );
}
