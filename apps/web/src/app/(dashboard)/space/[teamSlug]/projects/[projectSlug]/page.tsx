import { displayName } from "@open-doing/types";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import {
  getTeamProjectBySlug,
  listTeamProjects,
} from "@/features/projects/service";
import { ProjectDetailLayout } from "@/features/projects/components/ProjectDetailLayout";
import { ProjectDetailTabs } from "@/features/projects/components/ProjectDetailTabs";
import { ProjectMilestonesPanel } from "@/features/projects/components/ProjectMilestonesPanel";
import { ProjectProgressPanel } from "@/features/projects/components/ProjectProgressPanel";
import { ProjectOverviewPanel } from "@/features/projects/components/ProjectOverviewPanel";
import { ProjectPropertiesPanel } from "@/features/projects/components/ProjectPropertiesPanel";
import {
  buildProjectProgressPercent,
  listTeamProjectMembers,
  listProjectMilestonesWithProgress,
} from "@/features/projects/service";
import { TeamProjectHeader } from "@/features/tasks/components/TeamProjectHeader";
import { listTags } from "@/features/tags/service";
import { listTeamProjectTasks } from "@/features/tasks/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { KanbanStatStrip } from "@/features/kanban/components/KanbanStatStrip";
import { SpaceKanban } from "@/features/kanban/components/SpaceKanban";
import { SpaceKanbanFilterBar } from "@/features/kanban/components/SpaceKanbanFilterBar";
import { SpaceTaskTable } from "@/features/kanban/components/SpaceTaskTable";
import { TasksViewTabs } from "@/features/kanban/components/TasksViewTabs";
import { TeamTasksNewTaskButton } from "@/features/kanban/components/TeamTasksNewTaskButton";
import {
  getOlderDoneTeamTasks,
  getTeamKanbanStats,
  getTeamSpaceBoard,
} from "@/features/kanban/service";
import { parseStatFilterParams } from "@/features/kanban/stat-filter";
import { sortTaskRows } from "@/features/kanban/sort-task-rows";
import { parseProjectTabFrom } from "@/lib/project-tab";
import { parseTaskPage, parseTaskPageSize } from "@/lib/task-origin";
import { teamProjectHref, teamTaskHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

interface TeamProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ teamSlug: string; projectSlug: string }>;
  /** `?tab=` / `?view=` / `?page=` / `?size=` / 统计筛选：tab 外壳与任务 tab 解析。 */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 团队项目页（J-3 → 详情 tabs）：概览 / 任务 / 动态。
 *
 * 任务 tab 内嵌任务模块组件（项目过滤锁定，`taskOrigin="project"`），
 * 与 `/space/{teamSlug}/tasks?project=` 共享同一套看板 / 列表行为；
 * 动态 tab 的时间线由后续任务接入（当前回落概览内容）。
 * 团队不存在、非成员、项目不属于该团队一律 404，不泄露存在性。
 * 页面保持 RSC：按 tab 取数，交互全部下沉到 `"use client"` 组件。
 */
export default async function TeamProjectPage({
  params,
  searchParams,
}: TeamProjectPageProps) {
  const { teamSlug, projectSlug } = await params;
  const sp = await searchParams;
  const tab = parseProjectTabFrom(sp);
  const tCommon = await getTranslations("common");

  const user = await requireUser();
  const team = await getTeamBySlug(teamSlug);
  if (!team) notFound();

  const membership = await getMembership(team.id, user.id);
  if (!membership) notFound();

  const project = await getTeamProjectBySlug(team.id, projectSlug);
  if (!project) notFound();

  const [tasks, projectList, memberList, tagPool] = await Promise.all([
    listTeamProjectTasks({ teamId: team.id, projectId: project.id, actorId: user.id }),
    listTeamProjects(team.id),
    listMembers(team.id),
    listTags({ teamId: team.id }),
  ]);
  // 类型分流：任务打标入口只列 task 标签，项目编辑弹层只列 project 标签。
  const milestoneProgress = await listProjectMilestonesWithProgress(team.id, project.id);
  const projectMembers = await listTeamProjectMembers(team.id, project.id);
  // 编辑弹层的成员池 = 团队名册（可添加未入项目的成员）；meta 行展示用项目当前成员
  const memberRoster = (await listMembers(team.id)).map((view) => ({
    id: view.user.id,
    name: displayName(view.user),
    image: null,
  }));
  const taskTagPool = tagPool.filter((tag) => tag.type === "task");
  const projectTagPool = tagPool.filter((tag) => tag.type === "project");

  const projectOptions = projectList.map(({ id, name }) => ({ id, name }));
  const members = memberList.map(({ user: member }) => ({
    id: member.id,
    name: displayName(member),
  }));
  const today = todayInShanghai();
  // 面板用项目快照：members 由 listTeamProjectMembers 装载（getTeamProjectBySlug 不带成员），
  // Properties 卡据此回显成员；否则保存刷新后回显未设置。
  const detailProject = { ...project, members: projectMembers };

  // ---- 任务 tab：看板 / 列表 / 统计（项目过滤锁定，筛选与任务模块同构）----
  let tasksTabContent: ReactNode = null;
  if (tab === "tasks") {
    const initialView = firstValue(sp.view) === "list" ? "list" : "board";
    const initialPage = parseTaskPage(sp.page) ?? undefined;
    const initialPageSize = parseTaskPageSize(sp.size) ?? undefined;
    const unassignedOnly = firstValue(sp.assignee) === "unassigned";
    const statFilter = parseStatFilterParams(sp);
    const filter = {
      projectId: project.id,
      unassignedOnly,
      ...statFilter,
    };

    const [board, stats, olderDone] = await Promise.all([
      getTeamSpaceBoard(team.id, today, filter),
      getTeamKanbanStats(team.id, today, filter),
      getOlderDoneTeamTasks(team.id, today, filter),
    ]);

    // 卡片只有 projectId；任务详情挂在项目 slug 下，href 直接用当前项目。
    const allCards = [
      ...board.todo,
      ...board.inProgress,
      ...board.doneRecent,
      ...olderDone,
    ];
    const taskHrefs: Record<string, string> = Object.fromEntries(
      allCards.map((card) => [
        card.id,
        teamTaskHref(team.slug, project.slug, card.id),
      ]),
    );
    const rows = sortTaskRows(allCards);
    const projectHref = teamProjectHref(team.slug, project.slug);

    tasksTabContent = (
      <>
        <KanbanStatStrip
          stats={stats}
          today={today}
          active={{
            status: statFilter.status,
            overdue: statFilter.overdueOnly,
            dueSoon: statFilter.dueSoonOnly,
          }}
          basePath={projectHref}
          preserveParams={{
            tab: "tasks",
            ...(unassignedOnly ? { assignee: "unassigned" } : {}),
          }}
        />
        <SpaceKanbanFilterBar
          basePath={projectHref}
          unassignedOnly={unassignedOnly}
        />
        <div className="mt-6">
          <TasksViewTabs
            initialView={initialView}
            board={
              <SpaceKanban
                variant="team"
                board={board}
                projects={projectList}
                today={today}
                teamId={team.id}
                teamSlug={team.slug}
                role={membership.role}
                actorId={user.id}
                taskHrefs={taskHrefs}
                expandFilter={{ projectSlug: project.slug }}
                taskOrigin="project"
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
                taskOrigin="project"
                initialPage={initialPage}
                initialPageSize={initialPageSize}
              />
            }
          />
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <nav
        aria-label={tCommon("breadcrumb")}
        className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink-400)]"
      >
        <span className="shrink-0">{team.name}</span>
        <span aria-hidden="true">/</span>
        <strong className="truncate font-semibold text-[var(--ink-900)]">
          {project.name}
        </strong>
      </nav>

      {/* 概览页 PageHeader 不带标题（title 显式 undefined）：概览面板内的项目名是唯一 h1。 */}
      <PageHeader
        className="mt-2"
        title={undefined}
        actions={
          <>
            <TeamProjectHeader
              teamId={team.id}
              project={{
                id: project.id,
                name: project.name,
                description: project.description,
                startDate: project.startDate,
                endDate: project.endDate,
                priority: project.priority,
                status: project.status,
                leadId: project.leadId,
                memberIds: projectMembers.map((m) => m.id),
                tags: project.tags,
              }}
              projects={projectOptions}
              members={members}
              actorId={user.id}
              tagPool={taskTagPool}
            />
            {tab === "tasks" ? (
              <TeamTasksNewTaskButton
                teamId={team.id}
                projects={projectOptions}
                defaultProjectId={project.id}
                members={members}
                defaultAssigneeId={user.id}
                tagPool={taskTagPool}
              />
            ) : null}
          </>
        }
      />

      <div className="mt-4">
        <ProjectDetailTabs active={tab} />
      </div>

      <ProjectDetailLayout
        key={tab}
        sidebar={
          <>
            <ProjectPropertiesPanel
              project={detailProject}
              memberPool={memberRoster}
              canManage={can(membership.role, "team:manage_projects")}
              space={{ kind: "team", teamId: team.id }}
            />
            <ProjectMilestonesPanel
              space={{ kind: "team", teamId: team.id }}
              projectId={project.id}
              milestones={milestoneProgress.map((item) => item.milestone)}
              progress={Object.fromEntries(
                milestoneProgress.map((item) => [
                  item.milestone.id,
                  { taskCount: item.taskCount, doneCount: item.doneCount, percent: item.percent },
                ]),
              )}
              canManage={can(membership.role, "team:manage_projects")}
            />
            <ProjectProgressPanel
              percent={buildProjectProgressPercent(tasks, today)}
            />
          </>
        }
      >
        <div className="mt-5">
          {tab === "tasks" ? (
            tasksTabContent
          ) : (
            /* TODO(task 9): tab=activity 在时间线任务接入前回落概览内容。 */
            <ProjectOverviewPanel
              project={detailProject}
              milestones={milestoneProgress}
              projectTagPool={projectTagPool}
              displayLead={projectMembers.find((m) => m.id === project.leadId) ?? null}
              canManage={can(membership.role, "team:manage_projects")}
              space={{ kind: "team", teamId: team.id }}
            />
          )}
        </div>
      </ProjectDetailLayout>
    </div>
  );
}
