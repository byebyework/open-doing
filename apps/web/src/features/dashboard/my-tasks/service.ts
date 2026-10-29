import { addDays, type SpaceType, type TaskStatus } from "@open-doing/types";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { personalTaskHref, teamTaskHref } from "@/lib/routes";
import { db, type DbClient } from "@/server/db/client";
import {
  projects,
  subtasks,
  tasks,
  teamMemberships,
  teams,
} from "@/server/db/schema";

/** Dashboard 顶部统计（四项指标；进行中额外按空间拆分供卡片 delta 展示）。 */
export interface MyTaskStats {
  inProgress: number;
  /** 进行中按空间拆分：个人任务数（Dashboard「进行中」卡 delta）。 */
  inProgressPersonal: number;
  /** 进行中按空间拆分：团队任务数。 */
  inProgressTeam: number;
  dueSoon: number;
  /** 今天到期的未完成任务数（「今日 / 明日到期」卡 delta 用）。 */
  dueToday: number;
  overdue: number;
  doneThisWeek: number;
}

/**
 * 统计本人在全部空间的四项任务指标。
 *
 * 选择「一条多 count 聚合 SQL」而非四条独立 count：只扫描一次 `tasks` 表，
 * 用 `count(*) FILTER (WHERE ...)` 在同一次聚合中分别计数。
 */
export async function getMyTaskStats(
  input: { userId: string; today: string; weekStart: string },
  client: DbClient = db,
): Promise<MyTaskStats> {
  const { userId, today, weekStart } = input;
  const tomorrow = addDays(today, 1);

  const [row] = await client
    .select({
      inProgress: sql<number>`(count(*) filter (where ${tasks.status} = 'in_progress'))::int`,
      // 进行中按空间拆分（个人 / 团队），供 Dashboard 卡片 delta 展示。
      inProgressPersonal: sql<number>`(count(*) filter (where ${tasks.status} = 'in_progress' and ${tasks.spaceType} = 'personal'))::int`,
      inProgressTeam: sql<number>`(count(*) filter (where ${tasks.status} = 'in_progress' and ${tasks.spaceType} = 'team'))::int`,
      // 临期：未完成且截止日期为今天或明天。
      dueSoon: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} in (${today}::date, ${tomorrow}::date)))::int`,
      // 今天到期的未完成任务（dueSoon 的子集；卡 delta 需要不封顶的精确值）。
      dueToday: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} = ${today}::date))::int`,
      // 逾期：未完成且截止日期早于今天（当天不算逾期）。
      overdue: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}::date))::int`,
      // 本周完成：以 updatedAt 归入本周（周一为起点）。`weekStart` 是上海本地
      // 日历日，显式按 Asia/Shanghai 换算为 timestamptz，避免跟随数据库会话时区。
      doneThisWeek: sql<number>`(count(*) filter (where ${tasks.status} = 'done' and ${tasks.updatedAt} >= (${weekStart}::timestamp AT TIME ZONE 'Asia/Shanghai')))::int`,
    })
    .from(tasks)
    .where(eq(tasks.assigneeId, userId));

  return (
    row ?? {
      inProgress: 0,
      inProgressPersonal: 0,
      inProgressTeam: 0,
      dueSoon: 0,
      dueToday: 0,
      overdue: 0,
      doneThisWeek: 0,
    }
  );
}

/** Dashboard 任务列表项（个人 / 团队空间统一结构）。 */
export interface MyTaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  teamId: string | null;
  teamName: string | null;
  teamSlug: string | null;
  spaceType: SpaceType;
  subtaskCount: number;
  completedSubtaskCount: number;
  /** 个人任务详情页 / 团队任务详情页，见 lib/routes。 */
  href: string;
}

/** 拼任务详情链接；团队任务在应用层保证必有项目与团队。 */
function buildTaskHref(input: {
  id: string;
  spaceType: SpaceType;
  teamSlug: string | null;
  projectSlug: string | null;
}): string {
  if (input.spaceType === "personal") {
    return personalTaskHref(input.id);
  }

  return teamTaskHref(
    input.teamSlug ?? "",
    input.projectSlug ?? "",
    input.id,
  );
}

/** 个人 Dashboard「今天」列表：展示项 + 同条件全量计数（供页脚「还有 N 项」）。 */
export interface TodayBoard {
  /** 未完成且 `dueDate <= today`，按截止日期升序，封顶 `limit`。 */
  tasks: MyTaskListItem[];
  /** 同条件全量任务数（不受 limit 影响）。 */
  total: number;
}

/**
 * 个人 Dashboard 的「今天该看的」列表。
 *
 * 条件是 `assigneeId = userId and status <> 'done' and dueDate <= today`：
 * 个人 + 指派给我的团队任务天然都被 assignee 覆盖，不区分空间。
 * 列表按截止日期升序（逾期在前，今天最后）；本查询已排除空截止日期，
 * 无需 `nulls last`。count 与列表复用同一 where，各一条 SQL 并行执行。
 */
export async function getTodayBoard(
  input: { userId: string; today: string; limit?: number },
  client: DbClient = db,
): Promise<TodayBoard> {
  const { userId, today, limit = 20 } = input;

  const condition = and(
    eq(tasks.assigneeId, userId),
    ne(tasks.status, "done"),
    lte(tasks.dueDate, today),
  );

  const subtaskStats = client
    .select({
      taskId: subtasks.taskId,
      subtaskCount: sql<number>`count(*)::int`.as("subtask_count"),
      completedSubtaskCount: sql<number>`(count(*) filter (where ${subtasks.completed}))::int`.as(
        "completed_subtask_count",
      ),
    })
    .from(subtasks)
    .groupBy(subtasks.taskId)
    .as("subtask_stats");

  const [rows, countRows] = await Promise.all([
    client
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        projectName: projects.name,
        projectSlug: projects.slug,
        teamId: teams.id,
        teamName: teams.name,
        teamSlug: teams.slug,
        spaceType: tasks.spaceType,
        subtaskCount: sql<number>`coalesce(${subtaskStats.subtaskCount}, 0)::int`,
        completedSubtaskCount: sql<number>`coalesce(${subtaskStats.completedSubtaskCount}, 0)::int`,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(teams, eq(projects.teamId, teams.id))
      .leftJoin(subtaskStats, eq(subtaskStats.taskId, tasks.id))
      .where(condition)
      .orderBy(asc(tasks.dueDate), desc(tasks.createdAt))
      .limit(limit),
    client
      .select({ total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(condition),
  ]);

  return {
    tasks: rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      dueDate: row.dueDate ?? null,
      projectId: row.projectId ?? null,
      projectName: row.projectName ?? null,
      projectSlug: row.projectSlug ?? null,
      teamId: row.teamId ?? null,
      teamName: row.teamName ?? null,
      teamSlug: row.teamSlug ?? null,
      spaceType: row.spaceType,
      subtaskCount: row.subtaskCount,
      completedSubtaskCount: row.completedSubtaskCount,
      href: buildTaskHref({
        id: row.id,
        spaceType: row.spaceType,
        teamSlug: row.teamSlug,
        projectSlug: row.projectSlug,
      }),
    })),
    total: countRows[0]?.total ?? 0,
  };
}

/** 跨空间项目选项：用于 Dashboard 的任务创建表单。 */
export interface CrossSpaceProjectOption {
  projectId: string;
  projectName: string;
  projectSlug: string | null;
  teamId: string | null;
  teamName: string | null;
}

/**
 * 列出可选的个人项目与本人所在团队的项目。
 *
 * 个人项目在前，团队项目按团队分组（UI 负责分组展示）。
 */
export async function listCrossSpaceProjects(
  userId: string,
  client: DbClient = db,
): Promise<CrossSpaceProjectOption[]> {
  const rows = await client
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      teamId: projects.teamId,
      teamName: teams.name,
    })
    .from(projects)
    .leftJoin(teams, eq(projects.teamId, teams.id))
    .leftJoin(
      teamMemberships,
      and(
        eq(teamMemberships.teamId, projects.teamId),
        eq(teamMemberships.userId, userId),
      ),
    )
    .where(or(eq(projects.ownerId, userId), isNotNull(teamMemberships.userId)))
    .orderBy(
      // 个人项目（team_id 为 null）排在最前；团队项目按团队名、创建时间排序。
      sql`case when ${projects.teamId} is null then 0 else 1 end`,
      asc(teams.name),
      asc(projects.createdAt),
    );

  return rows;
}

/**
 * 计算今天所在自然周的周一日期（Asia/Shanghai 口径）。
 *
 * 实现已下沉到纯模块 `lib/today`：客户端组件也要用它做「本周完成」计数，
 * 若从本 service 导入会把数据库驱动带进浏览器包。此处 re-export 保持
 * 既有调用方（本 service / dashboard 页 / 测试）的导入路径不变。
 */
export { getWeekStart } from "@/lib/today";
