import type { SpaceType as SharedSpaceType, TaskStatus } from "@open-doing/types";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { projects, subtasks, tasks } from "@/server/db/schema";

/** 空间类型（沿用共享领域类型，本模块对外导出以便看板组件消费）。 */
export type SpaceType = SharedSpaceType;

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
 */
export async function getPersonalSpaceBoard(
  userId: string,
  today: string,
  client: DbClient = db,
): Promise<SpaceBoard> {
  const scope = and(
    eq(tasks.spaceType, "personal"),
    eq(tasks.assigneeId, userId),
  );
  const recentStart = doneWindowStart(today);

  const [todoRows, inProgressRows, doneRows, olderCountRows] = await Promise.all([
    selectCards(client, and(scope, eq(tasks.status, "todo")), activeOrder),
    selectCards(
      client,
      and(scope, eq(tasks.status, "in_progress")),
      activeOrder,
    ),
    selectCards(
      client,
      and(
        scope,
        eq(tasks.status, "done"),
        gte(tasks.updatedAt, recentStart),
      ),
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
 */
export async function getOlderDonePersonalTasks(
  userId: string,
  today: string,
  client: DbClient = db,
): Promise<KanbanCardItem[]> {
  const scope = and(
    eq(tasks.spaceType, "personal"),
    eq(tasks.assigneeId, userId),
  );

  const rows = await selectCards(
    client,
    and(
      scope,
      eq(tasks.status, "done"),
      lt(tasks.updatedAt, doneWindowStart(today)),
    ),
    doneOrder,
  );

  return rows.map(toCard);
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
  condition: SQL<unknown> | undefined,
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
