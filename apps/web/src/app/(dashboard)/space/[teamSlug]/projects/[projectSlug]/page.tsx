import { displayName } from "@open-doing/types";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/features/auth/session";
import {
  getTeamProjectBySlug,
  listTeamProjects,
} from "@/features/projects/service";
import {
  TeamProjectHeader,
  type TeamProjectView,
} from "@/features/tasks/components/TeamProjectHeader";
import { TeamProjectTaskTable } from "@/features/tasks/components/TeamProjectTaskTable";
import { TeamKanban } from "@/features/tasks/components/TeamKanban";
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
  const view: TeamProjectView = requestedView === "board" ? "board" : "list";

  const user = await requireUser();
  const team = await getTeamBySlug(teamSlug);
  if (!team) notFound();

  const membership = await getMembership(team.id, user.id);
  if (!membership) notFound();

  const project = await getTeamProjectBySlug(team.id, projectSlug);
  if (!project) notFound();

  const [tasks, projectList, memberList] = await Promise.all([
    listTeamProjectTasks({ teamId: team.id, projectId: project.id, actorId: user.id }),
    listTeamProjects(team.id),
    listMembers(team.id),
  ]);

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

      <header className="mt-2 flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
            {project.name}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--ink-500)]">
            {view === "board"
              ? t("boardDragHint")
              : t("teamProjectMeta", { tasks: tasks.length, members: participantCount })}
          </p>
        </div>

        <TeamProjectHeader
          teamId={team.id}
          project={{
            id: project.id,
            name: project.name,
            description: project.description,
          }}
          projectPath={projectPath}
          view={view}
          projects={projectOptions}
          members={members}
          actorId={user.id}
          canManage={can(membership.role, "team:manage_projects")}
          redirectTo={teamSettingsHref(team.slug)}
        />
      </header>

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
    </div>
  );
}
