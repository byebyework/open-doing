import type { Project } from "@open-doing/types";

import { NavSection } from "@/components/layout/NavSection";
import { getCurrentUser } from "@/features/auth/session";
import { listTeamProjectsForTeams } from "@/features/projects/service";

import { listReceivedInvites } from "../invites/service";
import { can, getMembership } from "../permissions";
import { listTeamsForUser } from "../service";
import { TeamsNavItem } from "./TeamsNavItem";

/**
 * 团队空间导航（T 轨道接线，J-1 扩团队项目二级项）。
 *
 * 未登录返回 null；已登录渲染「我的团队」分组（团队 → 项目 → 新建项目入口），
 * 以及「账号」分组的待处理邀请入口（含未处理数角标，对照原型）。
 * 侧栏同时在个人空间与团队上下文展示本分组（与原型一致），
 * `(dashboard)/layout.tsx` 只 import 本文件，任何轨道不得修改布局。
 */
export async function TeamsNav() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [teams, received] = await Promise.all([
    listTeamsForUser(user.id),
    listReceivedInvites(user.id),
  ]);

  // 角色与项目一次取齐：项目按团队分组，owner/admin 才显示新建入口。
  const [memberships, projectList] = await Promise.all([
    Promise.all(teams.map((team) => getMembership(team.id, user.id))),
    listTeamProjectsForTeams(teams.map((team) => team.id)),
  ]);

  const manageableTeamIds = new Set(
    teams
      .filter((_, index) =>
        can(memberships[index]?.role ?? null, "team:manage_projects"),
      )
      .map((team) => team.id),
  );

  const projectsByTeamId = new Map<string, Project[]>();
  for (const project of projectList) {
    if (!project.teamId) continue;
    const list = projectsByTeamId.get(project.teamId) ?? [];
    list.push(project);
    projectsByTeamId.set(project.teamId, list);
  }

  const pendingCount = received.filter((view) => view.invite.status === "pending").length;

  return (
    <>
      <NavSection title="我的团队">
        {teams.map((team) => {
          const teamProjects = projectsByTeamId.get(team.id) ?? [];

          return (
            <div key={team.id} className="flex flex-col">
              <TeamsNavItem href={`/teams/${team.slug}`}>
                {team.name}
              </TeamsNavItem>

              {teamProjects.map((project) => (
                <TeamsNavItem
                  key={project.id}
                  href={`/teams/${team.slug}/projects/${project.slug}`}
                  depth="child"
                >
                  {project.name}
                </TeamsNavItem>
              ))}

              {manageableTeamIds.has(team.id) ? (
                <TeamsNavItem href={`/teams/${team.slug}/projects/new`} depth="child">
                  ＋ 新建项目
                </TeamsNavItem>
              ) : null}
            </div>
          );
        })}
        <TeamsNavItem href="/teams/new">＋ 创建团队</TeamsNavItem>
      </NavSection>

      <NavSection title="账号">
        <TeamsNavItem
          href="/invites"
          trailing={
            pendingCount > 0 ? (
              <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[#ff5757] px-1 text-[11px] font-bold text-white">
                {pendingCount}
              </span>
            ) : undefined
          }
        >
          待处理邀请
        </TeamsNavItem>
      </NavSection>
    </>
  );
}
