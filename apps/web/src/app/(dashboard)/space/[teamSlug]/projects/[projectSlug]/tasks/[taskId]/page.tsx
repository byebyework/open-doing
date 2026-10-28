import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { getTeamProjectBySlug } from "@/features/projects/service";
import { TeamTaskDetailClient } from "@/features/tasks/components/TeamTaskDetailClient";
import {
  canAssignTask,
  canDeleteTask,
  canEditTask,
} from "@/features/tasks/permissions";
import { getTeamTaskDetail } from "@/features/tasks/service";
import { getMembership } from "@/features/teams/permissions";
import { getTeamBySlug, listMembers } from "@/features/teams/service";
import { teamProjectHref } from "@/lib/routes";

interface TeamTaskDetailPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{
    teamSlug: string;
    projectSlug: string;
    taskId: string;
  }>;
}

/**
 * 团队任务详情页（J-5）。
 *
 * 团队不存在 / 非成员 / 项目不属于该团队 / 任务不存在或跨空间（个人任务、
 * 跨团队任务）一律 404，不泄露存在性。权限位在服务端按角色计算，
 * 交互下沉到 `TeamTaskDetailClient`。
 */
export default async function TeamTaskDetailPage({
  params,
}: TeamTaskDetailPageProps) {
  const { teamSlug, projectSlug, taskId } = await params;

  const user = await requireUser();
  const team = await getTeamBySlug(teamSlug);
  if (!team) notFound();

  const membership = await getMembership(team.id, user.id);
  if (!membership) notFound();

  const project = await getTeamProjectBySlug(team.id, projectSlug);
  if (!project) notFound();

  const task = await getTeamTaskDetail({
    teamId: team.id,
    taskId,
    actorId: user.id,
  });

  // 任务必须存在，且确实属于 URL 中的项目（防止同团队内跨项目拼地址）。
  if (!task || task.projectId !== project.id) notFound();

  const memberList = await listMembers(team.id);
  const assigneeOptions = memberList.map(({ user: member }) => ({
    id: member.id,
    name: member.username,
  }));

  const permissionInput = {
    role: membership.role,
    actorId: user.id,
    assigneeId: task.assigneeId,
  };

  return (
    <TeamTaskDetailClient
      task={task}
      teamId={team.id}
      backHref={teamProjectHref(team.slug, project.slug)}
      currentUserId={user.id}
      permissions={{
        canEdit: canEditTask(permissionInput),
        canDelete: canDeleteTask(permissionInput),
        canAssign: canAssignTask(permissionInput),
      }}
      assigneeOptions={assigneeOptions}
    />
  );
}
