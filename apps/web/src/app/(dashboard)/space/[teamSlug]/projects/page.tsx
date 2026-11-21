import type { ProjectStatusKind } from "@open-doing/types";
import { averageProjectProgress, displayName, getProjectStatusKind } from "@open-doing/types";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { ProjectCreateDialog } from "@/features/projects/components/ProjectCreateDialog";
import {
  ProjectListTable,
  type ProjectListRow,
} from "@/features/projects/components/ProjectListTable";
import { getTeamProjectListWithStats } from "@/features/projects/service";
import { listTags, tagsByProjectId } from "@/features/tags/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { teamProjectHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

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
 * 团队空间项目列表（表格模式，对照原型 projects-list.png）。
 *
 * 权限：团队不存在或非成员一律 404（不泄露存在性）；「新建项目」弹窗只对
 * owner/admin 渲染，与 action 层的服务端权限门槛一致。状态与进度百分数
 * 由 RSC 侧推导组装进行数据，筛选/搜索在客户端进行（spec 裁定）；
 * 团队整体进度为项目等权平均（与 Dashboard 的任务级平均是两个口径）。
 */
export default async function TeamProjectsPage(
  props: PageProps<"/space/[teamSlug]/projects">,
) {
  const { teamSlug } = await props.params;
  const t = await getTranslations("projects");
  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const today = todayInShanghai();
  const list = await getTeamProjectListWithStats(team.id, today);
  const projectTagsMap = await tagsByProjectId(list.map((item) => item.project.id));
  const overallPercent = Math.round(
    averageProjectProgress(list.map((item) => item.stats.progress)) * 100,
  );
  const canManageProjects = can(membership.role, "team:manage_projects");
  const [tagPool, memberViews] = canManageProjects
    ? await Promise.all([listTags({ teamId: team.id }), listMembers(team.id)])
    : [[], []];
  const projectTagPool = tagPool.filter((tag) => tag.type === "project");
  const memberPool = memberViews.map((view) => ({
    id: view.user.id,
    name: displayName(view.user),
    image: null,
  }));

  const rows: ProjectListRow[] = list.map((item) => ({
    id: item.project.id,
    name: item.project.name,
    summary: item.project.summary,
    description: item.project.description,
    href: teamProjectHref(team.slug, item.project.slug),
    priority: item.project.priority,
    tags: projectTagsMap.get(item.project.id) ?? [],
    statusKind: getProjectStatusKind(item.stats.progress) as ProjectStatusKind,
    progressPercent: Math.round(item.stats.progress * 100),
    milestoneCount: item.milestoneCount,
    startDate: item.project.startDate,
    endDate: item.project.endDate,
    taskCount: item.stats.taskCount,
    doneCount: item.stats.doneCount,
    overdueCount: item.stats.overdueCount,
  }));

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-testid="projects-list-page">
      <PageHeader
        title={
          <>
            {t("listTitle")}{" "}
            <span className="inline-flex items-center rounded-full bg-[var(--color-primary-bg)] px-2.5 py-0.5 align-middle text-[12.5px] font-medium text-[var(--color-primary)]">
              {t("headerBadge", { count: rows.length, percent: overallPercent })}
            </span>
          </>
        }
        subtitle={t("listSubtitleTeam")}
        actions={
          canManageProjects ? (
            <ProjectCreateDialog
              space={{ kind: "team", teamId: team.id }}
              projectTagPool={projectTagPool}
              memberPool={memberPool}
              testIdPrefix="team-project"
              triggerTestId="projects-new-team-button"
            />
          ) : null
        }
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("listEmptyTitle")} description={t("listEmptyHint")} />
        </div>
      ) : (
        <div className="mt-6">
          <ProjectListTable
            rows={rows}
            space={{ kind: "team", teamId: team.id }}
            canManage={canManageProjects}
          />
        </div>
      )}
    </div>
  );
}
