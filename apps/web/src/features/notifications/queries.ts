import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NotificationType } from "@open-doing/types";

import {
  invitesHref,
  personalTaskHref,
  teamSettingsHref,
  teamTaskHref,
} from "@/lib/routes";
import { db, type DbClient } from "@/server/db/client";
import { notifications, projects, tasks, teams, users } from "@/server/db/schema";

/** 通知中心列表项（读模型，可直接序列化给客户端组件）。 */
export interface NotificationListItem {
  id: string;
  type: NotificationType;
  read: boolean;
  /** ISO 字符串。 */
  createdAt: string;
  /** 触发者用户名；系统产生（cron）为 null。 */
  actorName: string | null;
  teamName: string | null;
  taskTitle: string | null;
  /** 由 buildNotificationHref 推导；无关联对象时为 null。 */
  href: string | null;
}

/** 通知列表默认条数。 */
const DEFAULT_LIMIT = 20;

/**
 * 根据通知类型与关联对象推导前端跳转地址（纯函数，无 IO）。
 *
 * - `team_invite` / `team_join_approved` / `team_join_declined` → 邀请页；
 * - `team_join_requested` → 团队设置页（审批入口），缺 teamSlug 时为 null；
 * - 团队任务 → 团队任务详情页；
 * - 个人任务 → 个人任务详情页；
 * - 关联参数缺失时返回 null（避免拼出无效链接）。
 */
export function buildNotificationHref(item: {
  type: NotificationType;
  taskId?: string | null;
  spaceType?: string | null;
  teamSlug?: string | null;
  projectSlug?: string | null;
}): string | null {
  if (
    item.type === "team_invite" ||
    item.type === "team_join_approved" ||
    item.type === "team_join_declined"
  ) {
    return invitesHref();
  }

  if (item.type === "team_join_requested") {
    return item.teamSlug ? teamSettingsHref(item.teamSlug) : null;
  }

  if (!item.taskId) {
    return null;
  }

  if (item.spaceType === "team") {
    if (!item.teamSlug || !item.projectSlug) {
      return null;
    }
    return teamTaskHref(item.teamSlug, item.projectSlug, item.taskId);
  }

  if (item.spaceType === "personal") {
    return personalTaskHref(item.taskId);
  }

  return null;
}

/** 当前用户未读通知数（顶栏角标）。 */
export async function getUnreadNotificationCount(
  userId: string,
  client: DbClient = db,
): Promise<number> {
  const [row] = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));

  return row?.count ?? 0;
}

/**
 * 当前用户的通知列表，按创建时间倒序，默认 20 条。
 *
 * 两段式查询：先取通知行，再用 `inArray` 批量取任务/项目/团队/触发者，
 * 避免逐条 N+1 查询，最后在 JS 内组装读模型。
 */
export async function listNotifications(
  input: { userId: string; limit?: number },
  client: DbClient = db,
): Promise<NotificationListItem[]> {
  const rows = await client
    .select()
    .from(notifications)
    .where(eq(notifications.userId, input.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(input.limit ?? DEFAULT_LIMIT);

  if (rows.length === 0) {
    return [];
  }

  const taskIds = uniqueIds(rows.map((row) => row.taskId));
  const actorIds = uniqueIds(rows.map((row) => row.actorId));

  const [taskRows, actorRows] = await Promise.all([
    taskIds.length > 0
      ? client
          .select({
            id: tasks.id,
            title: tasks.title,
            spaceType: tasks.spaceType,
            projectId: tasks.projectId,
          })
          .from(tasks)
          .where(inArray(tasks.id, taskIds))
      : Promise.resolve([]),
    actorIds.length > 0
      ? client
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, actorIds))
      : Promise.resolve([]),
  ]);

  const taskById = new Map(taskRows.map((row) => [row.id, row]));

  // 项目：通知直接关联的优先，其次回落到任务所属项目。
  const projectIds = uniqueIds([
    ...rows.map((row) => row.projectId),
    ...taskRows.map((row) => row.projectId),
  ]);
  const projectRows =
    projectIds.length > 0
      ? await client
          .select({ id: projects.id, slug: projects.slug, teamId: projects.teamId })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [];
  const projectById = new Map(projectRows.map((row) => [row.id, row]));

  // 团队：通知直接关联的优先，其次回落到项目所属团队。
  const teamIds = uniqueIds([
    ...rows.map((row) => row.teamId),
    ...projectRows.map((row) => row.teamId),
  ]);
  const teamRows =
    teamIds.length > 0
      ? await client
          .select({ id: teams.id, name: teams.name, slug: teams.slug })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [];
  const teamById = new Map(teamRows.map((row) => [row.id, row]));
  const actorById = new Map(actorRows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const task = row.taskId ? taskById.get(row.taskId) : undefined;
    const projectId = row.projectId ?? task?.projectId ?? null;
    const project = projectId ? projectById.get(projectId) : undefined;
    const teamId = row.teamId ?? project?.teamId ?? null;
    const team = teamId ? teamById.get(teamId) : undefined;
    const actor = row.actorId ? actorById.get(row.actorId) : undefined;

    return {
      id: row.id,
      type: row.type,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
      actorName: actor?.username ?? null,
      teamName: team?.name ?? null,
      taskTitle: task?.title ?? null,
      href: buildNotificationHref({
        type: row.type,
        taskId: row.taskId,
        spaceType: task?.spaceType ?? null,
        teamSlug: team?.slug ?? null,
        projectSlug: project?.slug ?? null,
      }),
    };
  });
}

/**
 * 将单条通知置为已读。
 *
 * 仅当通知属于本人时生效；返回 false 表示通知不存在或非本人（不改动数据）。
 */
export async function markNotificationRead(
  input: { userId: string; notificationId: string },
  client: DbClient = db,
): Promise<boolean> {
  const updated = await client
    .update(notifications)
    .set({ read: true })
    .where(
      and(eq(notifications.id, input.notificationId), eq(notifications.userId, input.userId)),
    )
    .returning({ id: notifications.id });

  return updated.length > 0;
}

/** 将本人全部未读通知置为已读，返回本次置已读条数。 */
export async function markAllNotificationsRead(
  userId: string,
  client: DbClient = db,
): Promise<number> {
  const updated = await client
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
    .returning({ id: notifications.id });

  return updated.length;
}

/** 将本人在指定团队下的团队邀请通知置为已读（响应邀请后的清理）。 */
export async function markTeamInviteNotificationsRead(
  input: { userId: string; teamId: string },
  client: DbClient = db,
): Promise<void> {
  await client
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.teamId, input.teamId),
        eq(notifications.type, "team_invite"),
        eq(notifications.read, false),
      ),
    );
}

/**
 * 将审批人在指定团队下、针对某个申请人的未读「凭码申请」通知置为已读。
 *
 * 通知行没有 requestId，但 `actor_id = 申请人` + `team_id` 足以唯一锁定一次
 * 申请的通知扇出（同一申请人同团队至多一条 pending 申请）；因此审批/拒绝/撤回
 * 任一申请后，只清理该申请人的审批通知，不会误清其他待处理申请人。
 */
export async function markTeamJoinNotificationsRead(
  input: { teamId: string; applicantId: string },
  client: DbClient = db,
): Promise<void> {
  await client
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.type, "team_join_requested"),
        eq(notifications.teamId, input.teamId),
        eq(notifications.actorId, input.applicantId),
        eq(notifications.read, false),
      ),
    );
}

/** 去重并剔除空值，供批量 `inArray` 查询使用。 */
function uniqueIds(ids: (string | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}
