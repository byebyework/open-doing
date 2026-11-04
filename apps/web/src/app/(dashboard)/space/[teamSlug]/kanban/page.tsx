import type { Metadata } from "next";
import { aggregateProjectProgress } from "@open-doing/types";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/shadcn/button";
import { requireUser } from "@/features/auth/session";
import { KanbanStatStrip } from "@/features/kanban/components/KanbanStatStrip";
import { SpaceKanban } from "@/features/kanban/components/SpaceKanban";
import { SpaceKanbanFilterBar } from "@/features/kanban/components/SpaceKanbanFilterBar";
import {
  getTeamKanbanProjectProgress,
  getTeamKanbanStats,
  getTeamSpaceBoard,
} from "@/features/kanban/service";
import { parseStatFilterParams } from "@/features/kanban/stat-filter";
import { listTeamProjects } from "@/features/projects/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { moduleHref, teamProjectNewHref, teamTaskHref } from "@/lib/routes";
import { WEEKDAY_KEYS, todayInShanghai, weekdayIndex } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/kanban">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("meta");
  const tNav = await getTranslations("nav");

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: t("kanbanTitle") };

  return { title: t("teamModuleTitle", { team: team.name, module: await tNav("kanban") }) };
}

/**
 * 团队空间 Kanban（v1.1 M2）。
 *
 * 权限：团队不存在或非成员一律 404（不泄露存在性）。
 * 筛选：`?project={slug}` + `?assignee=unassigned` 由 RSC 解析成 projectId /
 * boolean 后服务端过滤三列与 done 计数；无效 slug 静默忽略。URL 写回由
 * client 筛选条负责。
 */
export default async function TeamKanbanPage(
  props: PageProps<"/space/[teamSlug]/kanban">,
) {
  const { teamSlug } = await props.params;
  const {
    project: projectParam,
    assignee: assigneeParam,
    ...statParams
  } = await props.searchParams;
  const requestedSlug = Array.isArray(projectParam)
    ? projectParam[0]
    : projectParam;
  const assigneeValue = Array.isArray(assigneeParam)
    ? assigneeParam[0]
    : assigneeParam;
  const statFilter = parseStatFilterParams(statParams);

  const t = await getTranslations("kanban");
  const tDate = await getTranslations("date");
  const tNav = await getTranslations("nav");
  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const today = todayInShanghai();
  const projects = await listTeamProjects(team.id);
  const activeProject = projects.find(
    (project) => project.slug === requestedSlug,
  );
  const unassignedOnly = assigneeValue === "unassigned";

  const filter = {
    ...(activeProject ? { projectId: activeProject.id } : {}),
    unassignedOnly,
    ...statFilter,
  };
  // 卡片、统计与项目进度共用同一组筛选谓词（统计带数字与看板内容不叉）。
  const [board, stats, progressEntries] = await Promise.all([
    getTeamSpaceBoard(team.id, today, filter),
    getTeamKanbanStats(team.id, today, filter),
    getTeamKanbanProjectProgress(team.id, today),
  ]);

  // 项目筛选下拉的 `· NN%`：slug → 进度 + 全部项目的简单平均。
  const progressBySlug = new Map(
    projects.map((project) => {
      const entry = progressEntries.find(
        (item) => item.projectId === project.id,
      );
      return [project.slug, entry?.progress ?? 0];
    }),
  );
  const allProjectsProgress = aggregateProjectProgress(
    progressEntries.map((entry) => entry.progress),
    progressEntries.length,
  );

  // 卡片只有 projectId；href 需要 project slug，用当前项目列表反查。
  const projectSlugById = new Map(
    projects.map((project) => [project.id, project.slug]),
  );
  const taskHrefs: Record<string, string> = {};
  for (const card of [...board.todo, ...board.inProgress, ...board.doneRecent]) {
    const projectSlug = projectSlugById.get(card.projectId);
    if (projectSlug) {
      taskHrefs[card.id] = teamTaskHref(team.slug, projectSlug, card.id);
    }
  }

  // 展开「更早」时沿用当前 URL 筛选（无筛选则不传）。
  const expandFilter =
    activeProject || unassignedOnly
      ? {
          ...(activeProject ? { projectSlug: activeProject.slug } : {}),
          ...(unassignedOnly ? { unassignedOnly: true } : {}),
        }
      : undefined;

  // 「N 个未完成任务」= todo + in_progress（对照原型
  // docs/prototypes/space-kanban-team.html 的 filterbar 文案，不含 done）。
  const incompleteTotal = board.todo.length + board.inProgress.length;
  const projectName = activeProject?.name ?? t("allProjects");
  // 新建项目入口与 /space/{teamSlug}/projects/new 的权限门槛保持一致：
  // 成员点击会直接 404，因此只对 owner / admin 渲染。
  const canManageProjects = can(membership.role, "team:manage_projects");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
            {tNav("kanban")}
          </h1>
          <p className="mt-1.5 text-[14px] text-[var(--ink-500)]">
            {t("teamSubtitle")}
          </p>
        </div>
        {canManageProjects ? (
          <div className="flex flex-none items-center gap-2">
            {/* 用 next/link 包 Button 做客户端导航（`Button href` 是普通 <a>，无 prefetch）。 */}
            <Link href={teamProjectNewHref(team.slug)}>
              <Button variant="outline">{t("newProjectButton")}</Button>
            </Link>
          </div>
        ) : null}
      </header>

      <KanbanStatStrip
        stats={stats}
        today={today}
        active={{
          status: statFilter.status,
          overdue: statFilter.overdueOnly,
          dueSoon: statFilter.dueSoonOnly,
        }}
        basePath={moduleHref(team.slug, "kanban")}
        preserveParams={{
          ...(activeProject ? { project: activeProject.slug } : {}),
          ...(unassignedOnly ? { assignee: "unassigned" } : {}),
        }}
      />

      <SpaceKanbanFilterBar
        variant="team"
        basePath={moduleHref(team.slug, "kanban")}
        projects={projects}
        activeProjectSlug={activeProject?.slug}
        unassignedOnly={unassignedOnly}
        statParams={{
          ...(statFilter.status ? { status: statFilter.status } : {}),
          ...(statFilter.overdueOnly ? { overdue: "1" } : {}),
          ...(statFilter.dueSoonOnly ? { dueSoon: "1" } : {}),
        }}
        projectProgress={Object.fromEntries(progressBySlug)}
        allProjectsProgress={allProjectsProgress}
        caption={t("captionTeam", {
          project: projectName,
          count: incompleteTotal,
        })}
        todayCaption={tDate("todayCaption", {
          date: today,
          weekday: tDate(WEEKDAY_KEYS[weekdayIndex(today)]),
        })}
      />

      <div className="mt-5">
        <SpaceKanban
          variant="team"
          board={board}
          projects={projects}
          today={today}
          teamId={team.id}
          teamSlug={team.slug}
          role={membership.role}
          actorId={user.id}
          taskHrefs={taskHrefs}
          expandFilter={expandFilter}
        />
      </div>
    </div>
  );
}
