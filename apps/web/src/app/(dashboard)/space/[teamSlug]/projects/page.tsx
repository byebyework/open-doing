import type { ProjectHealthKind } from "@open-doing/types";
import { averageProjectProgress, getProjectHealthKind } from "@open-doing/types";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/shadcn/button";
import { requireUser } from "@/features/auth/session";
import { ProjectStatsCard } from "@/features/projects/components/ProjectStatsCard";
import { getTeamProjectListWithStats } from "@/features/projects/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { teamProjectHref, teamProjectNewHref } from "@/lib/routes";
import { WEEKDAY_KEYS, todayInShanghai, weekdayIndex } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/projects">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("meta");
  const tNav = await getTranslations("nav");

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: t("projectsTitle") };

  return {
    title: t("teamModuleTitle", { team: team.name, module: await tNav("projects") }),
  };
}

/**
 * 团队空间项目列表（v1.2「项目」模块）。
 *
 * 权限：团队不存在或非成员一律 404（不泄露存在性）；「新建项目」只对
 * owner/admin 渲染，与 `/projects/new` 表单页的服务端权限门槛一致。
 * 健康徽标与进度聚合由 service 算好，页面只做展示；团队整体进度为
 * 项目等权平均（spec §7 口径，与 Dashboard 的任务级平均是两个口径）。
 */
export default async function TeamProjectsPage(
  props: PageProps<"/space/[teamSlug]/projects">,
) {
  const { teamSlug } = await props.params;
  const t = await getTranslations("projects");
  const tDate = await getTranslations("date");
  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const today = todayInShanghai();
  const list = await getTeamProjectListWithStats(team.id, today);
  const overallPercent = Math.round(
    averageProjectProgress(list.map((item) => item.stats.progress)) * 100,
  );
  const canManageProjects = can(membership.role, "team:manage_projects");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-testid="projects-list-page">
      <PageHeader
        title={t("listTitle")}
        subtitle={t("listSubtitleTeam")}
        actions={
          canManageProjects ? (
            <Link href={teamProjectNewHref(team.slug)} data-testid="projects-new-team-button">
              <Button variant="outline">{t("newProjectButton")}</Button>
            </Link>
          ) : null
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted-foreground)]">
        <span>{t("summaryTeam", { count: list.length, percent: overallPercent })}</span>
        <span>· {t("sortNote")}</span>
        <span className="ml-auto">
          {tDate("todayCaption", {
            date: today,
            weekday: tDate(WEEKDAY_KEYS[weekdayIndex(today)]),
          })}
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState title={t("listEmptyTitle")} description={t("listEmptyHint")} />
      ) : (
        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {list.map((item) => (
            <ProjectStatsCard
              key={item.project.id}
              name={item.project.name}
              description={item.project.description}
              href={teamProjectHref(team.slug, item.project.slug)}
              stats={item.stats}
              health={getProjectHealthKind(item.stats) as ProjectHealthKind}
            />
          ))}
        </div>
      )}
    </div>
  );
}
