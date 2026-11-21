import { displayName } from "@open-doing/types";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import {
  getTeamProjectBySlug,
  listTeamProjects,
} from "@/features/projects/service";
import { ProjectDetailLayout } from "@/features/projects/components/ProjectDetailLayout";
import { ProjectMilestonesPanel } from "@/features/projects/components/ProjectMilestonesPanel";
import { ProjectProgressPanel } from "@/features/projects/components/ProjectProgressPanel";
import { ProjectOverviewPanel } from "@/features/projects/components/ProjectOverviewPanel";
import { ProjectPropertiesPanel } from "@/features/projects/components/ProjectPropertiesPanel";
import {
  listTeamProjectMembers,
  listTeamProjectMilestones,
  listProjectMilestonesWithProgress,
} from "@/features/projects/service";
import {
  TeamProjectHeader,
  type TeamProjectView,
} from "@/features/tasks/components/TeamProjectHeader";
import { TeamProjectTaskTable } from "@/features/tasks/components/TeamProjectTaskTable";
import { TeamKanban } from "@/features/tasks/components/TeamKanban";
import { listTags } from "@/features/tags/service";
import { listTeamProjectTasks } from "@/features/tasks/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { teamProjectHref, teamSettingsHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

interface TeamProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ teamSlug: string; projectSlug: string }>;
  /** Next 16：searchParams 同样为 Promise。 */
  searchParams: Promise<{ view?: string | string[] }>;
}

/**
 * 团队项目页（J-3）：列表视图；看板在 J-4 接入 `?view=board`。
 *
 * 团队不存在、非成员、项目不属于该团队一律 404，不泄露存在性。
 * 页面保持 RSC：读取项目、任务、团队成员与项目选项；交互全部下沉到
 * `"use client"` 组件。
 */
export default async function TeamProjectPage({
  params,
  searchParams,
}: TeamProjectPageProps) {
  const { teamSlug, projectSlug } = await params;
  const { view: viewParam } = await searchParams;
  const t = await getTranslations("projects");
  const tCommon = await getTranslations("common");
  const requestedView = Array.isArray(viewParam) ? viewParam[0] : viewParam;
  const view: TeamProjectView =
    requestedView === "board" || requestedView === "list" ? requestedView : "overview";

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
  const participantCount = new Set(
    tasks.map((task) => task.assigneeId).filter((id): id is string => id !== null),
  ).size;
  const today = todayInShanghai();
  const projectPath = teamProjectHref(team.slug, project.slug);

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

      <PageHeader
        className="mt-2"
        title={view === "overview" ? undefined : project.name}
        subtitle={view === "overview" ? undefined : `${view === "board"
          ? t("boardDragHint")
          : t("teamProjectMeta", { tasks: tasks.length, members: participantCount })}${project.startDate && project.endDate ? ` · ${t("dateRange")}: ${project.startDate} → ${project.endDate}` : ""}`}
        actions={
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
            projectPath={projectPath}
            view={view}
            projects={projectOptions}
            members={members}
            actorId={user.id}
            canManage={can(membership.role, "team:manage_projects")}
            redirectTo={teamSettingsHref(team.slug)}
            tagPool={taskTagPool}
            projectTagPool={projectTagPool}
            memberPool={memberRoster}
            displayLead={projectMembers.find((m) => m.id === project.leadId) ?? null}
            displayMembers={projectMembers}
          />
        }
      />

      <ProjectDetailLayout
        sidebar={
          <>
            <ProjectPropertiesPanel
              project={project}
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
              percent={Math.round(
                (tasks.filter((task) => task.status === "done").length /
                  Math.max(tasks.length, 1)) *
                  100,
              )}
            />
          </>
        }
      >
        {view === "overview" ? (
          <div className="mt-5">
            <ProjectOverviewPanel
              project={project}
              milestones={milestoneProgress}
              projectTagPool={projectTagPool}
              displayLead={projectMembers.find((m) => m.id === project.leadId) ?? null}
              displayMembers={projectMembers}
              canManage={can(membership.role, "team:manage_projects")}
              space={{ kind: "team", teamId: team.id }}
            />
          </div>
        ) : (
          <div className="mt-5">
            {view === "board" ? (
          <TeamKanban
            teamId={team.id}
            teamSlug={team.slug}
            tasks={tasks}
            members={members}
            today={today}
            projectId={project.id}
            projects={projectOptions}
            role={membership.role}
            actorId={user.id}
            projectSlug={project.slug}
            tagPool={taskTagPool}
          />
        ) : (
          <TeamProjectTaskTable
            teamId={team.id}
            teamSlug={team.slug}
            tasks={tasks}
            members={members}
            today={today}
            projectId={project.id}
            projects={projectOptions}
            role={membership.role}
            actorId={user.id}
            projectSlug={project.slug}
          />
        )}
        </div>
      )}
      </ProjectDetailLayout>
    </div>
  );
}
