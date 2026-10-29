import type { SpaceType as SharedSpaceType, TaskStatus } from "@open-doing/types";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { projects, subtasks, tasks, users } from "@/server/db/schema";

/** 空间类型（沿用共享领域类型，本模块对外导出以便看板组件消费）。 */
export type SpaceType = SharedSpaceType;

/** 个人空间看板筛选（页面 / action 已把 URL slug 解析成 projectId）。 */
export interface PersonalSpaceBoardFilter {
  projectId?: string;
}

/** 团队空间看板筛选：项目 + 仅未指派（未指定字段即不过滤）。 */
export interface TeamSpaceBoardFilter {
  projectId?: string;
  unassignedOnly?: boolean;
}

/** 空间看板卡片（三列共用；done 卡额外带 `completedAt`）。 */
export interface KanbanCardItem {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  /** 子任务总数（SQL 聚合，参照 my-tasks service 的派生表模式）。 */
  subtaskTotal: number;
  subtaskDone: number;
  /** 仅 done 卡有值：任务 updatedAt（无独立完成时间列，完成时间以 updatedAt 为口径）。 */
  completedAt: string | null;
}

/** 个人空间看板：todo / in_progress 全量，done 收敛到近 7 天。 */
export interface SpaceBoard {
  todo: KanbanCardItem[];
  inProgress: KanbanCardItem[];
  /** updatedAt ∈ 近 7 天（含今天）。 */
  doneRecent: KanbanCardItem[];
  /** 更早已完成数（供「查看更早」展开链接）。 */
  doneOlderCount: number;
  doneTotal: number;
}

/** 团队空间看板卡片：在个人卡片基础上补充指派人信息（未指派为 null）。 */
export interface TeamKanbanCardItem extends KanbanCardItem {
  assigneeId: string | null;
  assigneeName: string | null;
}

/** 团队空间看板：todo / in_progress 全量，done 收敛到近 7 天。 */
export interface TeamSpaceBoard {
  todo: TeamKanbanCardItem[];
  inProgress: TeamKanbanCardItem[];
  /** updatedAt ∈ 近 7 天（含今天）。 */
  doneRecent: TeamKanbanCardItem[];
  /** 更早已完成数（供「查看更早」展开链接）。 */
  doneOlderCount: number;
  doneTotal: number;
}

/** done 卡对外字段（SQL 行）。 */
interface KanbanCardRow {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  subtaskTotal: number;
  subtaskDone: number;
  updatedAt: Date;
}

/** 团队 done 卡对外字段（SQL 行）：卡片公共字段 + 指派人。 */
interface TeamKanbanCardRow extends KanbanCardRow {
  assigneeId: string | null;
  assigneeName: string | null;
}

/**
 * 个人空间看板：跨项目聚合本人的全部个人任务。
 *
 * - 查询范围：`space_type = 'personal' AND assignee_id = userId`；
 * - todo / in_progress 按截止日期升序（逾期天然置顶，无截止 `nulls last`）；
 * - done 只取 `updatedAt >= today - 6`（含今天，上海日历日零点起算），
 *   按 updatedAt 降序；`doneOlderCount` 为窗口外数量，`doneTotal` 为两侧之和；
 * - 子任务计数用派生表一次聚合，避免逐卡查询。
 *
 * 零散个人任务（`project_id` 为空）同样纳入看板；其项目字段映射为空字符串
 * （冻结类型要求 projectId / projectName 为非空 string）。
 *
 * 第三个位置兼容两种入参：历史调用传 `DbClient`（测试注入），页面传筛选条件；
 * 也可同时传 `client` + `filter`。筛选同时作用于三列与 done 计数查询。
 */
export async function getPersonalSpaceBoard(
  userId: string,
  today: string,
  clientOrFilter: DbClient | PersonalSpaceBoardFilter = db,
  filter?: PersonalSpaceBoardFilter,
): Promise<SpaceBoard> {
  const { client, filter: resolvedFilter } = resolveClientAndFilter(
    clientOrFilter,
    filter,
  );
  const scope = personalScope(userId, resolvedFilter);
  const recentStart = doneWindowStart(today);

  const [todoRows, inProgressRows, doneRows, olderCountRows] = await Promise.all([
    selectCards(client, and(scope, eq(tasks.status, "todo"))!, activeOrder),
    selectCards(
      client,
      and(scope, eq(tasks.status, "in_progress"))!,
      activeOrder,
    ),
    selectCards(
      client,
      and(
        scope,
        eq(tasks.status, "done"),
        gte(tasks.updatedAt, recentStart),
      )!,
      doneOrder,
    ),
    client
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          scope,
          eq(tasks.status, "done"),
          lt(tasks.updatedAt, recentStart),
        ),
      ),
  ]);

  const doneOlderCount = olderCountRows[0]?.count ?? 0;

  return {
    todo: todoRows.map(toCard),
    inProgress: inProgressRows.map(toCard),
    doneRecent: doneRows.map(toCard),
    doneOlderCount,
    doneTotal: doneRows.length + doneOlderCount,
  };
}

/**
 * 个人空间中完成时间早于近 7 天窗口的全部任务（供「查看更早」展开）。
 *
 * 条件是 `updatedAt < today - 6`，排序与 done 列一致（updatedAt 降序）。
 * 入参形态与 `getPersonalSpaceBoard` 一致（client / filter 兼容）。
 */
export async function getOlderDonePersonalTasks(
  userId: string,
  today: string,
  clientOrFilter: DbClient | PersonalSpaceBoardFilter = db,
  filter?: PersonalSpaceBoardFilter,
): Promise<KanbanCardItem[]> {
  const { client, filter: resolvedFilter } = resolveClientAndFilter(
    clientOrFilter,
    filter,
  );
  const scope = personalScope(userId, resolvedFilter);

  const rows = await selectCards(
    client,
    and(
      scope,
      eq(tasks.status, "done"),
      lt(tasks.updatedAt, doneWindowStart(today)),
    )!,
    doneOrder,
  );

  return rows.map(toCard);
}

/**
 * 团队空间看板：聚合 `teamId` 下全部项目的团队任务（含未指派）。
 *
 * - 查询范围：`space_type = 'team' AND projects.team_id = teamId`；
 * - 排序 / 7 天窗口与个人空间完全一致（`activeOrder` / `doneOrder`）；
 * - `assigneeName` 经 `LEFT JOIN users` 取得，未指派（含成员被移除后置空）为 null。
 *
 * 调用方（页面 / action）负责先做团队成员资格校验；本函数不做权限判断。
 * 第三个位置兼容 `DbClient` 与筛选条件（同 `getPersonalSpaceBoard`）；
 * 筛选同时作用于三列与 done 计数查询。
 */
export async function getTeamSpaceBoard(
  teamId: string,
  today: string,
  clientOrFilter: DbClient | TeamSpaceBoardFilter = db,
  filter?: TeamSpaceBoardFilter,
): Promise<TeamSpaceBoard> {
  const { client, filter: resolvedFilter } = resolveClientAndFilter(
    clientOrFilter,
    filter,
  );
  const scope = teamScope(teamId, resolvedFilter);
  const recentStart = doneWindowStart(today);

  const [todoRows, inProgressRows, doneRows, olderCountRows] = await Promise.all([
    selectTeamCards(
      client,
      andDefined(scope, eq(tasks.status, "todo")),
      activeOrder,
    ),
    selectTeamCards(
      client,
      andDefined(scope, eq(tasks.status, "in_progress")),
      activeOrder,
    ),
    selectTeamCards(
      client,
      andDefined(
        scope,
        eq(tasks.status, "done"),
        gte(tasks.updatedAt, recentStart),
      ),
      doneOrder,
    ),
    client
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          scope,
          eq(tasks.status, "done"),
          lt(tasks.updatedAt, recentStart),
        ),
      ),
  ]);

  const doneOlderCount = olderCountRows[0]?.count ?? 0;

  return {
    todo: todoRows.map(toTeamCard),
    inProgress: inProgressRows.map(toTeamCard),
    doneRecent: doneRows.map(toTeamCard),
    doneOlderCount,
    doneTotal: doneRows.length + doneOlderCount,
  };
}

/**
 * 团队空间中完成时间早于近 7 天窗口的全部任务（供「查看更早」展开）。
 *
 * 条件是 `updatedAt < today - 6`，排序与 done 列一致（updatedAt 降序）；
 * 同样包含未指派任务。调用方负责团队成员资格校验。
 * 入参形态与 `getTeamSpaceBoard` 一致（client / filter 兼容）。
 */
export async function getOlderDoneTeamTasks(
  teamId: string,
  today: string,
  clientOrFilter: DbClient | TeamSpaceBoardFilter = db,
  filter?: TeamSpaceBoardFilter,
): Promise<TeamKanbanCardItem[]> {
  const { client, filter: resolvedFilter } = resolveClientAndFilter(
    clientOrFilter,
    filter,
  );
  const scope = teamScope(teamId, resolvedFilter);

  const rows = await selectTeamCards(
    client,
    andDefined(
      scope,
      eq(tasks.status, "done"),
      lt(tasks.updatedAt, doneWindowStart(today)),
    ),
    doneOrder,
  );

  return rows.map(toTeamCard);
}

/** 个人任务范围：本人的个人任务 + 可选项目筛选。 */
function personalScope(
  userId: string,
  filter?: PersonalSpaceBoardFilter,
): SQL<unknown> {
  const conditions: (SQL | undefined)[] = [
    eq(tasks.spaceType, "personal"),
    eq(tasks.assigneeId, userId),
  ];

  if (filter?.projectId) {
    conditions.push(eq(tasks.projectId, filter.projectId));
  }

  return andDefined(...conditions);
}

/**
 * 团队任务范围：`space_type = 'team'` 且任务所属项目属于该团队。
 *
 * 以项目归属而非指派人过滤，未指派任务天然纳入。注意：schema 并不约束
 * 「团队任务必属某个团队项目」（`tasks.project_id` 可空、无 CHECK），该保证
 * 来自创建路径——创建的任务必有项目；若无项目归属，任务会从看板静默消失。
 *
 * 筛选条件与范围条件走同一组谓词，列查询与计数查询不会分叉。
 */
function teamScope(
  teamId: string,
  filter?: TeamSpaceBoardFilter,
): SQL<unknown> {
  const conditions: (SQL | undefined)[] = [
    eq(tasks.spaceType, "team"),
    inArray(projects.teamId, [teamId]),
  ];

  if (filter?.projectId) {
    conditions.push(eq(tasks.projectId, filter.projectId));
  }
  if (filter?.unassignedOnly) {
    conditions.push(isNull(tasks.assigneeId));
  }

  return andDefined(...conditions);
}

/**
 * 解析第三 / 第四入参：历史调用 `(userId, today, client)`、新调用
 * `(userId, today, filter)` 与 `(userId, today, client, filter)` 均可用。
 *
 * 仅用于保持既有调用点（测试显式注入 DbClient）无需改动；DbClient 的判别
 * 依据是 drizzle client 必有 `select` 方法，筛选条件对象不含该字段。
 */
function resolveClientAndFilter<TFilter>(
  clientOrFilter: DbClient | TFilter,
  filter?: TFilter,
): { client: DbClient; filter: TFilter | undefined } {
  if (isDbClient(clientOrFilter)) {
    return { client: clientOrFilter, filter };
  }

  return { client: db, filter: clientOrFilter };
}

function isDbClient(value: unknown): value is DbClient {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { select?: unknown }).select === "function"
  );
}

/**
 * `and()` 的收窄包装：入参均为已定义的 SQL 时结果必非空，断言收在一处。
 *
 * 直接用 `and()` 会把 `SQL | undefined` 泄漏给调用点，逐处加 `!` 会重新打开
 * fail-open 风险——一旦某处漏断言，条件静默变 undefined，过滤被整体丢弃。
 */
function andDefined(...conditions: (SQL | undefined)[]): SQL<unknown> {
  return and(...conditions)!;
}

/**
 * 近 7 天窗口起点：`today - 6` 的上海日历日零点，返回 timestamptz。
 *
 * `today` 是 Asia/Shanghai 的 `YYYY-MM-DD`；显式 `AT TIME ZONE 'Asia/Shanghai'`
 * 换算，避免跟随数据库会话时区（与 my-tasks 的周起点口径一致）。
 */
function doneWindowStart(today: string) {
  return sql`((${today}::date - 6)::timestamp AT TIME ZONE 'Asia/Shanghai')`;
}

/** todo / in_progress 列：截止升序，逾期天然在前，无截止垫底；同日按创建时间降序。 */
function activeOrder(): SQL[] {
  return [sql`${tasks.dueDate} asc nulls last`, desc(tasks.createdAt)];
}

/** done 列：最近完成在前。 */
function doneOrder(): SQL[] {
  return [desc(tasks.updatedAt)];
}

/**
 * 一次查询取卡片公共字段 + 项目归属 + 子任务计数。
 *
 * 子任务派生表按 task 聚合 `count(*)` / `count(*) filter (completed)`，
 * 再 left join；无子任务的卡片计数为 0。
 */
async function selectCards(
  client: DbClient,
  condition: SQL<unknown>,
  orderBy: () => SQL[],
): Promise<KanbanCardRow[]> {
  const subtaskStats = client
    .select({
      taskId: subtasks.taskId,
      subtaskTotal: sql<number>`count(*)::int`.as("subtask_total"),
      subtaskDone: sql<number>`(count(*) filter (where ${subtasks.completed}))::int`.as(
        "subtask_done",
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
      projectId: projects.id,
      projectName: projects.name,
      subtaskTotal: sql<number>`coalesce(${subtaskStats.subtaskTotal}, 0)::int`,
      subtaskDone: sql<number>`coalesce(${subtaskStats.subtaskDone}, 0)::int`,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(subtaskStats, eq(subtaskStats.taskId, tasks.id))
    .where(condition)
    .orderBy(...orderBy());

  return rows;
}

/**
 * 团队卡片查询：结构与 `selectCards` 对称，额外 `LEFT JOIN users` 取指派人。
 *
 * 未指派任务的 `assigneeName` 为 null；子任务派生表与个人侧完全一致。
 */
async function selectTeamCards(
  client: DbClient,
  condition: SQL<unknown>,
  orderBy: () => SQL[],
): Promise<TeamKanbanCardRow[]> {
  const subtaskStats = client
    .select({
      taskId: subtasks.taskId,
      subtaskTotal: sql<number>`count(*)::int`.as("subtask_total"),
      subtaskDone: sql<number>`(count(*) filter (where ${subtasks.completed}))::int`.as(
        "subtask_done",
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
      projectId: projects.id,
      projectName: projects.name,
      subtaskTotal: sql<number>`coalesce(${subtaskStats.subtaskTotal}, 0)::int`,
      subtaskDone: sql<number>`coalesce(${subtaskStats.subtaskDone}, 0)::int`,
      updatedAt: tasks.updatedAt,
      assigneeId: tasks.assigneeId,
      assigneeName: users.username,
    })
    // inner join 而非 left join：团队范围条件含 `projects.team_id`，团队任务
    // 必有项目（创建路径保证），join 类型只表达这一意图，与计数查询一致。
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(subtaskStats, eq(subtaskStats.taskId, tasks.id))
    .where(condition)
    .orderBy(...orderBy());

  return rows;
}

/** SQL 行 → 看板卡片；done 卡的 completedAt 取 updatedAt（ISO 字符串）。 */
function toCard(row: KanbanCardRow): KanbanCardItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.dueDate ?? null,
    projectId: row.projectId ?? "",
    projectName: row.projectName ?? "",
    subtaskTotal: row.subtaskTotal,
    subtaskDone: row.subtaskDone,
    completedAt: row.status === "done" ? row.updatedAt.toISOString() : null,
  };
}

/** SQL 行 → 团队看板卡片；在个人卡片基础上补充指派人（未指派为 null）。 */
function toTeamCard(row: TeamKanbanCardRow): TeamKanbanCardItem {
  return {
    ...toCard(row),
    assigneeId: row.assigneeId ?? null,
    assigneeName: row.assigneeName ?? null,
  };
}
