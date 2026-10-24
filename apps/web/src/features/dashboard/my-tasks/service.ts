import { addDays, type SpaceType, type TaskStatus } from "@open-doing/types";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import {
  projects,
  subtasks,
  tasks,
  teamMemberships,
  teams,
} from "@/server/db/schema";

/** 「我的任务」页顶部四项统计。 */
export interface MyTaskStats {
  inProgress: number;
  dueSoon: number;
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
      // 临期：未完成且截止日期为今天或明天。
      dueSoon: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} in (${today}::date, ${tomorrow}::date)))::int`,
      // 逾期：未完成且截止日期早于今天（当天不算逾期）。
      overdue: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}::date))::int`,
      // 本周完成：以 updatedAt 归入本周（周一为起点）。`weekStart` 是上海本地
      // 日历日，显式按 Asia/Shanghai 换算为 timestamptz，避免跟随数据库会话时区。
      doneThisWeek: sql<number>`(count(*) filter (where ${tasks.status} = 'done' and ${tasks.updatedAt} >= (${weekStart}::timestamp AT TIME ZONE 'Asia/Shanghai')))::int`,
    })
    .from(tasks)
    .where(eq(tasks.assigneeId, userId));

  return row ?? { inProgress: 0, dueSoon: 0, overdue: 0, doneThisWeek: 0 };
}

/** 「我的任务」列表项（个人 / 团队空间统一结构）。 */
export interface MyTaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  teamName: string | null;
  teamSlug: string | null;
  spaceType: SpaceType;
  subtaskCount: number;
  completedSubtaskCount: number;
  /** 个人：/my/tasks/{id}；团队：/teams/{teamSlug}/projects/{projectSlug}/tasks/{id} */
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
    return `/my/tasks/${input.id}`;
  }

  return `/teams/${input.teamSlug}/projects/${input.projectSlug}/tasks/${input.id}`;
}

/**
 * 列表查询公共实现：任务左联项目 / 团队，并用子查询聚合子任务计数。
 *
 * 子任务计数在 SQL 侧一次 group by 完成（left join 派生表），
 * 不在应用层逐任务查询，避免 N+1。
 */
async function queryTaskList(
  condition: SQL | undefined,
  client: DbClient,
): Promise<MyTaskListItem[]> {
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

  const rows = await client
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
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
    // 有截止日期在前升序，无日期最后；同日按创建时间降序。
    .orderBy(sql`${tasks.dueDate} asc nulls last`, desc(tasks.createdAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.dueDate ?? null,
    projectId: row.projectId ?? null,
    projectName: row.projectName ?? null,
    projectSlug: row.projectSlug ?? null,
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
  }));
}

/**
 * 本人的个人任务：零散任务（无项目）或本人个人项目中的任务。
 *
 * 项目名称缺失时由 UI 决定是否展示「不属于项目」口径。
 */
export async function listMyPersonalTasks(
  userId: string,
  client: DbClient = db,
): Promise<MyTaskListItem[]> {
  const personalProjectIds = client
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, userId));

  return queryTaskList(
    and(
      eq(tasks.assigneeId, userId),
      eq(tasks.spaceType, "personal"),
      or(isNull(tasks.projectId), inArray(tasks.projectId, personalProjectIds)),
    ),
    client,
  );
}

/** 本人被指派的任务：跨全部团队空间。 */
export async function listMyTeamTasks(
  userId: string,
  client: DbClient = db,
): Promise<MyTaskListItem[]> {
  return queryTaskList(
    and(eq(tasks.assigneeId, userId), eq(tasks.spaceType, "team")),
    client,
  );
}

/** 跨空间项目选项：用于「我的任务」页的任务创建表单。 */
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
 * 入参 `today` 已是上海时区的 `YYYY-MM-DD` 日历日，因此直接按 UTC
 * 毫秒做日历算术即可（与 `addDays` 一致），不引入系统时区依赖。
 */
export function getWeekStart(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  // getUTCDay: 0=周日 … 6=周六；换算为「周一=0」的偏移。
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const offset = (weekday + 6) % 7;

  return addDays(today, -offset);
}
