import type { TaskStatus } from "@open-doing/types";
import { addDays } from "@open-doing/types";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import { personalScope, teamScope } from "@/features/kanban/service";
import { getMonthEnd, getMonthGrid, getWeekStart } from "@/lib/today";
import { db, type DbClient } from "@/server/db/client";
import { projects, tasks, users } from "@/server/db/schema";

/** 日历格 / 侧栏共用的一条任务（进本结构的一定有截止日期）。 */
export interface CalendarTaskItem {
  id: string;
  title: string;
  /** 截止日期；进本结构的一定有值。 */
  dueDate: string;
  /** status === "done" */
  done: boolean;
  projectId: string | null;
  /** 无项目时为 ""（沿用 KanbanCardItem 的非空 string 约定） */
  projectName: string;
  /** 团队任务的责任人；个人任务恒为本人 id；未指派为 null */
  assigneeId: string | null;
  /** 未指派为 null（成员被移除后不崩） */
  assigneeName: string | null;
}

/** 空间日历一次取数的全部数据（个人 / 团队共用结构）。 */
export interface SpaceCalendarData {
  /** 所显示月份 42 天网格窗口内的任务，dueDate 升序、createdAt 降序平局 */
  items: CalendarTaskItem[];
  /** 可见范围内无截止日期的任务数（含任意状态，Ruling 5） */
  noDueCount: number;
  /** 今天所在自然周（周一起）7 天内截止的任务，dueDate 升序；含 done（Ruling 2） */
  weekItems: CalendarTaskItem[];
  /** (weekEnd, 今天所在月月末] 截止且未 done 的任务，dueDate 升序（Ruling 1/2） */
  monthUpcoming: CalendarTaskItem[];
}

/** 个人日历查询行（无 assignee 列：个人任务恒为 scope 用户本人）。 */
interface CalendarRow {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
}

/** 团队日历查询行：公共字段 + 指派人（未指派为 null）。 */
interface TeamCalendarRow extends CalendarRow {
  assigneeId: string | null;
  assigneeName: string | null;
}

/**
 * 个人空间日历：本人个人任务按截止日期落格。
 *
 * 三个窗口互相独立（计划 Ruling 1：侧栏恒锚「今天」，不随所显示月份翻动）：
 * - `items`：所显示月份的 42 天网格 `[grid.start, grid.end]`，含任意状态；
 * - `weekItems`：今天所在自然周 `[weekStart, weekStart + 6]`，含 done；
 * - `monthUpcoming`：`(weekEnd, 今天所在月月末]` 且未 done；
 * - `noDueCount`：本人个人任务中 `due_date IS NULL` 的条数（含任意状态）。
 *
 * 排序统一 `dueDate asc, createdAt desc`；四组查询并行执行。
 * 调用方负责保证 `month` 为已校验的 `YYYY-MM`。
 */
export async function getPersonalSpaceCalendar(
  userId: string,
  month: string,
  today: string,
  client: DbClient = db,
): Promise<SpaceCalendarData> {
  const scope = personalScope(userId);
  const { grid, weekStart, weekEnd, monthEnd } = calendarWindows(month, today);

  const [itemRows, noDueCount, weekRows, upcomingRows] = await Promise.all([
    selectPersonalCalendarRows(
      client,
      dueWithin(scope, grid.start, grid.end),
    ),
    countPersonalNoDue(client, scope),
    selectPersonalCalendarRows(
      client,
      dueWithin(scope, weekStart, weekEnd),
    ),
    selectPersonalCalendarRows(
      client,
      andUpcoming(scope, weekEnd, monthEnd),
    ),
  ]);

  return {
    items: itemRows.map((row) => toPersonalItem(row, userId)),
    noDueCount,
    weekItems: weekRows.map((row) => toPersonalItem(row, userId)),
    monthUpcoming: upcomingRows.map((row) => toPersonalItem(row, userId)),
  };
}

/**
 * 团队空间日历：团队 `teamId` 下全部项目的团队任务（含未指派）按截止日期落格。
 *
 * 窗口 / 排序 / `noDueCount` 口径与个人空间完全一致；`assigneeName` 经
 * `LEFT JOIN users` 取得，未指派（含成员被移除后置空）为 null。
 * 调用方（页面）负责先做团队成员资格校验；本函数不做权限判断。
 */
export async function getTeamSpaceCalendar(
  teamId: string,
  month: string,
  today: string,
  client: DbClient = db,
): Promise<SpaceCalendarData> {
  const scope = teamScope(teamId);
  const { grid, weekStart, weekEnd, monthEnd } = calendarWindows(month, today);

  const [itemRows, noDueCount, weekRows, upcomingRows] = await Promise.all([
    selectTeamCalendarRows(
      client,
      dueWithin(scope, grid.start, grid.end),
    ),
    countTeamNoDue(client, scope),
    selectTeamCalendarRows(
      client,
      dueWithin(scope, weekStart, weekEnd),
    ),
    selectTeamCalendarRows(
      client,
      andUpcoming(scope, weekEnd, monthEnd),
    ),
  ]);

  return {
    items: itemRows.map(toTeamItem),
    noDueCount,
    weekItems: weekRows.map(toTeamItem),
    monthUpcoming: upcomingRows.map(toTeamItem),
  };
}

interface CalendarWindows {
  grid: { start: string; end: string };
  weekStart: string;
  weekEnd: string;
  monthEnd: string;
}

/**
 * 三个查询窗口。
 *
 * 月网格来自 `getMonthGrid(month)`；侧栏锚定 `today`（Ruling 1）：本周为
 * `getWeekStart(today)` 起 7 天，「本月即将到期」上界是**今天所在月**的月末。
 */
function calendarWindows(month: string, today: string): CalendarWindows {
  const weekStart = getWeekStart(today);

  return {
    grid: getMonthGrid(month),
    weekStart,
    weekEnd: addDays(weekStart, 6),
    monthEnd: getMonthEnd(today.slice(0, 7)),
  };
}

/** 截止日期落在闭区间 `[from, to]`（含任意状态）。 */
function dueWithin(
  scope: SQL<unknown>,
  from: string,
  to: string,
): SQL<unknown> {
  return and(scope, gte(tasks.dueDate, from), lte(tasks.dueDate, to))!;
}

/** 「本月即将到期」：`(weekEnd, monthEnd]` 且未完成。 */
function andUpcoming(
  scope: SQL<unknown>,
  weekEnd: string,
  monthEnd: string,
): SQL<unknown> {
  return and(
    scope,
    gt(tasks.dueDate, weekEnd),
    lte(tasks.dueDate, monthEnd),
    ne(tasks.status, "done"),
  )!;
}

/** 日历统一排序：截止日期升序，同日按创建时间降序。 */
function calendarOrder(): SQL[] {
  return [asc(tasks.dueDate), desc(tasks.createdAt)];
}

/**
 * 个人日历行查询：`LEFT JOIN projects` 取项目名（零散个人任务为空）。
 *
 * `personalScope` 只引用 `tasks`，不需要 join 才能过滤；join 仅为展示字段。
 */
async function selectPersonalCalendarRows(
  client: DbClient,
  condition: SQL<unknown>,
): Promise<CalendarRow[]> {
  return client
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(condition)
    .orderBy(...calendarOrder());
}

/**
 * 团队日历行查询：`INNER JOIN projects`（`teamScope` 含 `projects.team_id`
 * 谓词，团队任务必有项目），`LEFT JOIN users` 取指派人。
 */
async function selectTeamCalendarRows(
  client: DbClient,
  condition: SQL<unknown>,
): Promise<TeamCalendarRow[]> {
  return client
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      assigneeId: tasks.assigneeId,
      assigneeName: users.username,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(condition)
    .orderBy(...calendarOrder());
}

/** 个人空间无截止日期计数（含任意状态）。 */
async function countPersonalNoDue(
  client: DbClient,
  scope: SQL<unknown>,
): Promise<number> {
  const rows = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(scope, isNull(tasks.dueDate)));

  return rows[0]?.count ?? 0;
}

/** 团队空间无截止日期计数（`teamScope` 需要 join projects）。 */
async function countTeamNoDue(
  client: DbClient,
  scope: SQL<unknown>,
): Promise<number> {
  const rows = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(scope, isNull(tasks.dueDate)));

  return rows[0]?.count ?? 0;
}

/**
 * 个人行 → 日历条目。
 *
 * 个人任务的 `assignee_id` 由 scope 保证等于 `userId`，因此无需 join users；
 * `assigneeName` 在个人版不渲染，恒为 null。
 */
function toPersonalItem(
  row: CalendarRow,
  userId: string,
): CalendarTaskItem {
  return {
    id: row.id,
    title: row.title,
    // 窗口条件保证 due_date 非空。
    dueDate: row.dueDate!,
    done: row.status === "done",
    projectId: row.projectId ?? null,
    projectName: row.projectName ?? "",
    assigneeId: userId,
    assigneeName: null,
  };
}

/** 团队行 → 日历条目；未指派 / 成员被移除后置空均为 null。 */
function toTeamItem(row: TeamCalendarRow): CalendarTaskItem {
  return {
    id: row.id,
    title: row.title,
    // 窗口条件保证 due_date 非空。
    dueDate: row.dueDate!,
    done: row.status === "done",
    projectId: row.projectId ?? null,
    projectName: row.projectName ?? "",
    assigneeId: row.assigneeId ?? null,
    assigneeName: row.assigneeName ?? null,
  };
}
