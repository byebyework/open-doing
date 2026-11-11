import type {
  SpaceType as SharedSpaceType,
  TaskPriority,
  TaskStatus,
} from "@open-doing/types";
import { addDays, aggregateProjectProgress, getTaskProgress } from "@open-doing/types";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
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
  /** 只看某状态（统计带「待开始 / 进行中 / 已完成」chip）。 */
  status?: TaskStatus;
  /** 只看逾期（dueDate < today 且未完成）。 */
  overdueOnly?: boolean;
  /** 只看临期（today <= dueDate <= today+3 且未完成）。 */
  dueSoonOnly?: boolean;
}

/** 团队空间看板筛选：项目 + 仅未指派 + 统计带筛选（未指定字段即不过滤）。 */
export interface TeamSpaceBoardFilter {
  projectId?: string;
  unassignedOnly?: boolean;
  status?: TaskStatus;
  overdueOnly?: boolean;
  dueSoonOnly?: boolean;
}

/** 空间看板卡片（三列共用；done 卡额外带 `completedAt`）。 */
export interface KanbanCardItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
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
  priority: TaskPriority;
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
  assigneeUsername: string | null;
  assigneeNickname: string | null;
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
  const scope = withStatFilterPredicates(
    personalScope(userId, resolvedFilter),
    today,
    resolvedFilter,
  );
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
  const scope = withStatFilterPredicates(
    personalScope(userId, resolvedFilter),
    today,
    resolvedFilter,
  );

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
  const scope = withStatFilterPredicates(
    teamScope(teamId, resolvedFilter),
    today,
    resolvedFilter,
  );
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
  const scope = withStatFilterPredicates(
    teamScope(teamId, resolvedFilter),
    today,
    resolvedFilter,
  );

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
export function personalScope(
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
export function teamScope(
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
 * 统计带筛选谓词（status / overdueOnly / dueSoonOnly），卡片查询与统计共用，
 * 不分叉。日期比较用 `YYYY-MM-DD` 字符串的字典序（date 列 ISO 口径安全），
 * 不经 `new Date()` 本地时区换算。
 */
function statFilterPredicates(
  today: string,
  filter?: Pick<
    PersonalSpaceBoardFilter,
    "status" | "overdueOnly" | "dueSoonOnly"
  >,
): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];

  if (filter?.status) {
    conditions.push(eq(tasks.status, filter.status));
  }
  if (filter?.overdueOnly) {
    conditions.push(lt(tasks.dueDate, today));
    conditions.push(ne(tasks.status, "done"));
  }
  if (filter?.dueSoonOnly) {
    conditions.push(gte(tasks.dueDate, today));
    conditions.push(lte(tasks.dueDate, addDays(today, 3)));
    conditions.push(ne(tasks.status, "done"));
  }

  return conditions;
}

/** 把统计带筛选谓词并入既有范围谓词（空筛选时原样返回 scope）。 */
function withStatFilterPredicates(
  scope: SQL<unknown>,
  today: string,
  filter?: Pick<
    PersonalSpaceBoardFilter,
    "status" | "overdueOnly" | "dueSoonOnly"
  >,
): SQL<unknown> {
  return andDefined(scope, ...statFilterPredicates(today, filter));
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
      priority: tasks.priority,
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
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      subtaskTotal: sql<number>`coalesce(${subtaskStats.subtaskTotal}, 0)::int`,
      subtaskDone: sql<number>`coalesce(${subtaskStats.subtaskDone}, 0)::int`,
      updatedAt: tasks.updatedAt,
      assigneeId: tasks.assigneeId,
      assigneeUsername: users.username,
      assigneeNickname: users.name,
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
    priority: row.priority,
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
    // 展示名：昵称优先，未填写（或个人任务 join 不到用户）回退到用户名。
    assigneeName: row.assigneeNickname ?? row.assigneeUsername ?? null,
  };
}

/** 看板统计带计数（Phase 0 口径，与统计带 chips 一一对应）。 */
export interface KanbanStats {
  /** 未开始（排除已完成）。 */
  todo: number;
  /** 进行中（排除已完成）。 */
  inProgress: number;
  /** 近 7 天完成（与 done 列同口径 doneWindowStart）。 */
  doneRecent: number;
  /** 逾期：dueDate < today 且未完成。 */
  overdue: number;
  /** 临期：today <= dueDate <= today+3 且未完成。 */
  dueSoon: number;
}

/**
 * 个人空间看板统计（统计即筛选的数字来源）。
 *
 * 单条聚合查询：五个计数各用 `count(*) filter (where …)`，范围谓词与卡片
 * 查询同源（personalScope + 统计带筛选谓词），不会分叉。
 * 入参形态与 `getPersonalSpaceBoard` 一致（client / filter 兼容）。
 */
export async function getPersonalKanbanStats(
  userId: string,
  today: string,
  clientOrFilter: DbClient | PersonalSpaceBoardFilter = db,
  filter?: PersonalSpaceBoardFilter,
): Promise<KanbanStats> {
  const { client, filter: resolvedFilter } = resolveClientAndFilter(
    clientOrFilter,
    filter,
  );
  const scope = withStatFilterPredicates(
    personalScope(userId, resolvedFilter),
    today,
    resolvedFilter,
  );

  const [row] = await client
    .select(kanbanStatsSelect(today))
    .from(tasks)
    .where(scope);

  return row!;
}

/**
 * 团队空间看板统计：口径与个人侧完全一致。
 *
 * 范围为 teamScope（项目归属 + 未指派筛选）+ 统计带筛选谓词。
 * 调用方负责团队成员资格校验。入参形态与 `getTeamSpaceBoard` 一致。
 */
export async function getTeamKanbanStats(
  teamId: string,
  today: string,
  clientOrFilter: DbClient | TeamSpaceBoardFilter = db,
  filter?: TeamSpaceBoardFilter,
): Promise<KanbanStats> {
  const { client, filter: resolvedFilter } = resolveClientAndFilter(
    clientOrFilter,
    filter,
  );
  const scope = withStatFilterPredicates(
    teamScope(teamId, resolvedFilter),
    today,
    resolvedFilter,
  );

  const [row] = await client
    .select(kanbanStatsSelect(today))
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(scope);

  return row!;
}

/** 五个统计计数的一次性 select 片段（`count(*) filter` 各自独立）。 */
function kanbanStatsSelect(today: string) {
  const dueSoonEnd = addDays(today, 3);
  const recentStart = doneWindowStart(today);

  return {
    todo: sql<number>`(count(*) filter (where ${tasks.status} = 'todo'))::int`,
    inProgress: sql<number>`(count(*) filter (where ${tasks.status} = 'in_progress'))::int`,
    doneRecent: sql<number>`(count(*) filter (where ${tasks.status} = 'done' and ${tasks.updatedAt} >= ${recentStart}))::int`,
    overdue: sql<number>`(count(*) filter (where ${tasks.dueDate} < ${today} and ${tasks.status} <> 'done'))::int`,
    dueSoon: sql<number>`(count(*) filter (where ${tasks.dueDate} >= ${today} and ${tasks.dueDate} <= ${dueSoonEnd} and ${tasks.status} <> 'done'))::int`,
  };
}

/** 团队看板项目进度条目（供项目筛选下拉追加 `· NN%`）。 */
export interface ProjectProgressEntry {
  projectId: string;
  /** 0 ~ 1；与 Dashboard 健康度卡同源（taskProgress + aggregateProjectProgress）。 */
  progress: number;
}

/**
 * 团队各项目的聚合进度：每任务进度取 getTaskProgress（子任务完成比，
 * 无子任务按状态映射），项目进度为各任务进度的简单平均（aggregateProjectProgress）。
 *
 * 只统计 `space_type = 'team'` 的任务（与 Dashboard 健康度口径一致）；
 * 无任务的项目 progress 为 0，仍出现在结果里（下拉需要完整项目列表）。
 * `today` 参数为计划冻结签名保留（进度公式与日期无关）。
 */
export async function getTeamKanbanProjectProgress(
  teamId: string,
  today: string,
  client: DbClient = db,
): Promise<ProjectProgressEntry[]> {
  void today;

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
      projectId: projects.id,
      status: tasks.status,
      subtaskTotal: sql<number>`coalesce(${subtaskStats.subtaskTotal}, 0)::int`,
      subtaskDone: sql<number>`coalesce(${subtaskStats.subtaskDone}, 0)::int`,
    })
    .from(projects)
    .leftJoin(
      tasks,
      and(eq(tasks.projectId, projects.id), eq(tasks.spaceType, "team")),
    )
    .leftJoin(subtaskStats, eq(subtaskStats.taskId, tasks.id))
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.createdAt));

  const progressAccumulators = new Map<string, number[]>();
  for (const row of rows) {
    const progresses = progressAccumulators.get(row.projectId) ?? [];
    if (row.status !== null) {
      // 用「子任务计数」还原 getTaskProgress 入参，保持进度口径唯一
      // （与 Dashboard 健康度卡的 taskProgress 完全一致）。
      progresses.push(
        getTaskProgress({
          status: row.status,
          subtasks: Array.from({ length: row.subtaskTotal }, (_, index) => ({
            completed: index < row.subtaskDone,
          })),
        }),
      );
    }
    progressAccumulators.set(row.projectId, progresses);
  }

  return [...progressAccumulators.entries()].map(([projectId, progresses]) => ({
    projectId,
    progress: aggregateProjectProgress(progresses, progresses.length),
  }));
}
