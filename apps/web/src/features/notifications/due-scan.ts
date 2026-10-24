import { addDays, isDueSoon, isOverdue } from "@open-doing/types";
import { and, eq, inArray, isNotNull, lt, ne, or } from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { notifications, projects, tasks } from "@/server/db/schema";

/** 单次到期扫描的写入统计（按实际插入行数计，去重后的数量）。 */
export interface DueScanResult {
  dueSoon: number;
  overdue: number;
}

/**
 * 当前上海时区的日期（`YYYY-MM-DD`）。
 *
 * 与数据库的 date 列、`@open-doing/types` 的日期工具保持同一格式；
 * `now` 可注入，便于测试固定时刻。
 */
export function shanghaiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * 扫描到期任务并投递通知（幂等）。
 *
 * 规则：
 * - 只看 `status != 'done'`、有截止日期且已指派的任务；
 * - `due_date < today` → `task_overdue`；
 * - `due_date` 为 today 或明天 → `task_due_soon`；
 * - 接收人 = assignee，`actorId = null`，带任务自身的 team/project/task 关联。
 *
 * 幂等：单条批量 `INSERT ... ON CONFLICT DO NOTHING`，由部分唯一索引
 * `(user_id, task_id, type) WHERE task_id IS NOT NULL` 兜底，重复扫描不新增行。
 * 返回值只统计本次真正插入的通知行数。
 */
export async function runDueScan(
  client: DbClient = db,
  today: string = shanghaiToday(),
): Promise<DueScanResult> {
  const target = client;
  const tomorrow = addDays(today, 1);

  const rows = await target
    .select({
      id: tasks.id,
      status: tasks.status,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      projectId: tasks.projectId,
      teamId: projects.teamId,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        isNotNull(tasks.assigneeId),
        or(lt(tasks.dueDate, today), inArray(tasks.dueDate, [today, tomorrow])),
      ),
    );

  const values: (typeof notifications.$inferInsert)[] = [];
  for (const row of rows) {
    if (!row.dueDate || !row.assigneeId) {
      continue; // SQL 已过滤，这里仅用于收窄类型。
    }

    const type = isOverdue(row.dueDate, row.status, today)
      ? "task_overdue"
      : isDueSoon(row.dueDate, row.status, today)
        ? "task_due_soon"
        : null;
    if (!type) {
      continue;
    }

    values.push({
      userId: row.assigneeId,
      type,
      teamId: row.teamId,
      projectId: row.projectId,
      taskId: row.id,
      actorId: null,
    });
  }

  if (values.length === 0) {
    return { dueSoon: 0, overdue: 0 };
  }

  // 单条批量 INSERT；冲突（重复扫描）直接跳过，只返回真正插入的行。
  const inserted = await target
    .insert(notifications)
    .values(values)
    .onConflictDoNothing()
    .returning({ type: notifications.type });

  let dueSoon = 0;
  let overdue = 0;
  for (const row of inserted) {
    if (row.type === "task_due_soon") {
      dueSoon += 1;
    } else if (row.type === "task_overdue") {
      overdue += 1;
    }
  }

  return { dueSoon, overdue };
}
