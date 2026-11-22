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
  buildProjectProgressPercent,
  listTeamProjectMembers,
  listProjectMilestonesWithProgress,
} from "@/features/projects/service";
import { TeamProjectHeader } from "@/features/tasks/components/TeamProjectHeader";
import { listTags } from "@/features/tags/service";
import { listTeamProjectTasks } from "@/features/tasks/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { todayInShanghai } from "@/lib/today";

interface TeamProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ teamSlug: string; projectSlug: string }>;
}

/**
 * 团队项目页（J-3）：仅概览。
 *
 * 任务列表 / 看板已收敛到团队任务模块（`/space/{teamSlug}/tasks`，URL 契约
 * `?view=list&project={slug}` / `?project={slug}`）。团队不存在、非成员、
 * 项目不属于该团队一律 404，不泄露存在性。页面保持 RSC：读取项目、任务
 * （进度用）、团队成员与项目选项；交互全部下沉到 `"use client"` 组件。
 */
export default async function TeamProjectPage({
  params,
}: TeamProjectPageProps) {
  const { teamSlug, projectSlug } = await params;
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
        }
      />

      <ProjectDetailLayout
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
          <ProjectOverviewPanel
            project={detailProject}
            milestones={milestoneProgress}
            projectTagPool={projectTagPool}
            displayLead={projectMembers.find((m) => m.id === project.leadId) ?? null}
            canManage={can(membership.role, "team:manage_projects")}
            space={{ kind: "team", teamId: team.id }}
          />
        </div>
      </ProjectDetailLayout>
    </div>
  );
}
