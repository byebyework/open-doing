import type { NotificationType } from "@open-doing/types";
import { db, type DbClient } from "@/server/db/client";
import { notifications } from "@/server/db/schema";

/** 通知创建入参（F-3 冻结契约，M1 起 T/J/G 轨道直接 import 调用）。 */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  read?: boolean;
  teamId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  actorId?: string | null;
}

/**
 * 创建一条系统内通知（桩实现）。
 *
 * 只做一次 INSERT，不含任何业务规则（去重、收件人推导、跳过自己等均由调用方负责）。
 * 幂等由 `notifications` 的部分唯一索引 `(user_id, task_id, type)` 兜底。
 *
 * 传入事务 client 即可与业务写入同事务；缺省使用全局 db。
 */
export async function createNotification(
  input: CreateNotificationInput,
  client?: DbClient,
): Promise<void> {
  const target = client ?? db;
  await target.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    read: input.read ?? false,
    teamId: input.teamId ?? null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    actorId: input.actorId ?? null,
  });
}
