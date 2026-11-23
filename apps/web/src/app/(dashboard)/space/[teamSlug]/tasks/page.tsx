import type { Metadata } from "next";
import { aggregateProjectProgress, displayName } from "@open-doing/types";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/shadcn/button";
import { requireUser } from "@/features/auth/session";
import { KanbanStatStrip } from "@/features/kanban/components/KanbanStatStrip";
import { SpaceKanban } from "@/features/kanban/components/SpaceKanban";
import { SpaceKanbanFilterBar } from "@/features/kanban/components/SpaceKanbanFilterBar";
import { SpaceTaskTable } from "@/features/kanban/components/SpaceTaskTable";
import { sortTaskRows } from "@/features/kanban/sort-task-rows";
import { TasksViewTabs } from "@/features/kanban/components/TasksViewTabs";
import { TeamTasksNewTaskButton } from "@/features/kanban/components/TeamTasksNewTaskButton";
import {
  getOlderDoneTeamTasks,
  getTeamKanbanProjectProgress,
  getTeamKanbanStats,
  getTeamSpaceBoard,
} from "@/features/kanban/service";
import { parseStatFilterParams } from "@/features/kanban/stat-filter";
import { listTeamProjects } from "@/features/projects/service";
import { listTags } from "@/features/tags/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { moduleHref, teamProjectNewHref, teamTaskHref } from "@/lib/routes";
import { WEEKDAY_KEYS, todayInShanghai, weekdayIndex } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/tasks">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("meta");
  const tNav = await getTranslations("nav");

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: t("tasksTitle") };

  return { title: t("teamModuleTitle", { team: team.name, module: await tNav("tasks") }) };
}

/**
 * 团队空间任务（v1.1 M2，原 Kanban 模块改名）。
 *
 * 权限：团队不存在或非成员一律 404（不泄露存在性）。
 * 筛选：`?project={slug}` + `?assignee=unassigned` 由 RSC 解析成 projectId /
 * boolean 后服务端过滤三列与 done 计数；无效 slug 静默忽略。URL 写回由
 * client 筛选条负责。
 */
export default async function TeamTasksPage(
  props: PageProps<"/space/[teamSlug]/tasks">,
) {
  const { teamSlug } = await props.params;
  const {
    project: projectParam,
    assignee: assigneeParam,
    view: viewParam,
    ...statParams
  } = await props.searchParams;
  const requestedSlug = Array.isArray(projectParam)
    ? projectParam[0]
    : projectParam;
  const assigneeValue = Array.isArray(assigneeParam)
    ? assigneeParam[0]
    : assigneeParam;
  // 双视图：`?view=list` 即列表，无 view（含非法值）回归看板默认。
  const requestedView = Array.isArray(viewParam) ? viewParam[0] : viewParam;
  const initialView = requestedView === "list" ? "list" : "board";
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
  // 卡片、统计、列表的窗口外已完成与项目进度共用同一组筛选谓词
  // （统计带数字与看板内容不叉）；成员 / 标签池供页头新建任务弹窗。
  const [board, stats, progressEntries, olderDone, memberList, tagPool] =
    await Promise.all([
      getTeamSpaceBoard(team.id, today, filter),
      getTeamKanbanStats(team.id, today, filter),
      getTeamKanbanProjectProgress(team.id, today),
      getOlderDoneTeamTasks(team.id, today, filter),
      listMembers(team.id),
      listTags({ teamId: team.id }),
    ]);
  // 类型分流：任务打标入口只列 task 标签（先例团队项目页）。
  const taskTagPool = tagPool.filter((tag) => tag.type === "task");

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
  const allCards = [
    ...board.todo,
    ...board.inProgress,
    ...board.doneRecent,
    ...olderDone,
  ];
  for (const card of allCards) {
    const projectSlug = projectSlugById.get(card.projectId);
    if (projectSlug) {
      taskHrefs[card.id] = teamTaskHref(team.slug, projectSlug, card.id);
    }
  }
  // 列表视图行 = 三列卡片 + 窗口外已完成；无 href 的行（项目被删）退化为非链接标题。
  const rows = sortTaskRows(allCards);

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
      <PageHeader
        title={tNav("tasks")}
        subtitle={t("teamSubtitle")}
        actions={
          <>
            {/* 新建任务对所有成员开放（service 层再做成员裁决）。 */}
            <TeamTasksNewTaskButton
              teamId={team.id}
              projects={projects.map(({ id, name }) => ({ id, name }))}
              defaultProjectId={activeProject?.id ?? null}
              members={memberList.map(({ user: member }) => ({
                id: member.id,
                name: displayName(member),
              }))}
              defaultAssigneeId={user.id}
              tagPool={taskTagPool}
            />
            {canManageProjects ? (
              /* 用 next/link 包 Button 做客户端导航（`Button href` 是普通 <a>，无 prefetch）。 */
              <Link href={teamProjectNewHref(team.slug)}>
                <Button variant="outline">{t("newProjectButton")}</Button>
              </Link>
            ) : null}
          </>
        }
      />

      <KanbanStatStrip
        stats={stats}
        today={today}
        active={{
          status: statFilter.status,
          overdue: statFilter.overdueOnly,
          dueSoon: statFilter.dueSoonOnly,
        }}
        basePath={moduleHref(team.slug, "tasks")}
        preserveParams={{
          ...(activeProject ? { project: activeProject.slug } : {}),
          ...(unassignedOnly ? { assignee: "unassigned" } : {}),
        }}
      />

      <SpaceKanbanFilterBar
        variant="team"
        basePath={moduleHref(team.slug, "tasks")}
        unassignedOnly={unassignedOnly}
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
        <TasksViewTabs
          initialView={initialView}
          projects={projects}
          projectProgress={Object.fromEntries(progressBySlug)}
          allProjectsProgress={allProjectsProgress}
          board={
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
          }
          list={
            <SpaceTaskTable
              variant="team"
              rows={rows}
              today={today}
              taskHrefs={taskHrefs}
              teamId={team.id}
              teamSlug={team.slug}
              role={membership.role}
              actorId={user.id}
            />
          }
        />
      </div>
    </div>
  );
}
