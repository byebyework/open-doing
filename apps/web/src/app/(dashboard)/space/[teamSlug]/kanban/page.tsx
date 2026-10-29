import type { Metadata } from "next";
import { Button } from "antd";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { SpaceKanban } from "@/features/kanban/components/SpaceKanban";
import { SpaceKanbanFilterBar } from "@/features/kanban/components/SpaceKanbanFilterBar";
import { getTeamSpaceBoard } from "@/features/kanban/service";
import { listTeamProjects } from "@/features/projects/service";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { moduleHref, teamProjectNewHref, teamTaskHref } from "@/lib/routes";
import { todayInShanghai, weekdayLabel } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/kanban">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: "Kanban · Open Doing" };

  return { title: `${team.name} Kanban · Open Doing` };
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
  const { project: projectParam, assignee: assigneeParam } =
    await props.searchParams;
  const requestedSlug = Array.isArray(projectParam)
    ? projectParam[0]
    : projectParam;
  const assigneeValue = Array.isArray(assigneeParam)
    ? assigneeParam[0]
    : assigneeParam;

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

  const board = await getTeamSpaceBoard(
    team.id,
    today,
    activeProject || unassignedOnly
      ? { projectId: activeProject?.id, unassignedOnly }
      : undefined,
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

  // 「N 个任务」= 当前筛选下的全部卡片（doneTotal 已按筛选计算）。
  const total = board.todo.length + board.inProgress.length + board.doneTotal;
  const projectName = activeProject?.name ?? "全部项目";
  const canManageProjects = can(membership.role, "team:manage_projects");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            Kanban
          </h1>
          <p className="mt-1.5 text-[14px] text-[#5f6368]">
            团队全部任务的状态全景：按项目筛选，拖拽卡片切换状态；未指派任务在这里认领。
          </p>
        </div>
        {canManageProjects ? (
          <div className="flex flex-none items-center gap-2">
            <Button href={teamProjectNewHref(team.slug)}>＋ 新建项目</Button>
          </div>
        ) : null}
      </header>

      <SpaceKanbanFilterBar
        variant="team"
        basePath={moduleHref(team.slug, "kanban")}
        projects={projects}
        activeProjectSlug={activeProject?.slug}
        unassignedOnly={unassignedOnly}
        caption={`当前筛选：${projectName} · ${total} 个任务`}
        todayCaption={`基准日期 ${today}（${weekdayLabel(today)}）`}
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
