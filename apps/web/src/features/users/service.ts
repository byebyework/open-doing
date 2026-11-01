import type { User } from "@open-doing/types";
import { eq } from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";

/** users 表中可映射为领域模型的列。 */
type UserRow = {
  id: string;
  uid: string;
  username: string;
  createdAt: Date;
};

/** 数据库行 -> 可跨边界传递的领域 User（时间统一为 ISO 字符串）。 */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    uid: row.uid,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 按内部主键查询用户；不存在返回 null。 */
export async function getUserById(
  id: string,
  client: DbClient = db,
): Promise<User | null> {
  const [row] = await client.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUser(row) : null;
}

/** 按对外 UID（doing_xxxx）查询用户；邀请流程（T-2）使用。 */
export async function findByUid(
  uid: string,
  client: DbClient = db,
): Promise<User | null> {
  const [row] = await client.select().from(users).where(eq(users.uid, uid)).limit(1);
  return row ? toUser(row) : null;
}

/** 登录凭据：领域 User + 仅供 auth service 使用的密码哈希。 */
export interface UserCredentials {
  user: User;
  passwordHash: string;
}

/** 按用户名读取登录凭据；不存在返回 null。 */
export async function getCredentialsByUsername(
  username: string,
  client: DbClient = db,
): Promise<UserCredentials | null> {
  const [row] = await client
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!row) return null;
  return { user: toUser(row), passwordHash: row.passwordHash };
}

/** 用户名是否已被占用（注册前置检查）。 */
export async function usernameExists(
  username: string,
  client: DbClient = db,
): Promise<boolean> {
  const [row] = await client
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return Boolean(row);
}

/** 个人设置：提醒开关领域模型（可跨边界传递）。 */
export interface ReminderPrefs {
  dueSoonReminderEnabled: boolean;
  overdueReminderEnabled: boolean;
}

/** 只取提醒开关两列，避免把密码哈希等字段带出。 */
const reminderPrefsColumns = {
  dueSoonReminderEnabled: users.dueSoonReminderEnabled,
  overdueReminderEnabled: users.overdueReminderEnabled,
} as const;

/** 读取用户提醒偏好；用户不存在时抛错（个人设置在会话内必然对应真实用户）。 */
export async function getReminderPrefs(
  userId: string,
  client: DbClient = db,
): Promise<ReminderPrefs> {
  const [row] = await client
    .select(reminderPrefsColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new Error("user not found");
  return row;
}

/**
 * 部分更新提醒偏好：只写显式传入的键，未传的列保持库中原值；
 * 返回更新后的全量偏好。用户不存在时抛错。
 */
export async function updateReminderPrefs(
  input: {
    userId: string;
    dueSoonReminderEnabled?: boolean;
    overdueReminderEnabled?: boolean;
  },
  client: DbClient = db,
): Promise<ReminderPrefs> {
  const patch: Partial<ReminderPrefs> = {};
  if (input.dueSoonReminderEnabled !== undefined) {
    patch.dueSoonReminderEnabled = input.dueSoonReminderEnabled;
  }
  if (input.overdueReminderEnabled !== undefined) {
    patch.overdueReminderEnabled = input.overdueReminderEnabled;
  }

  // 没有任何键需要更新：不执行空 SET，直接返回当前值（仍校验用户存在）。
  if (Object.keys(patch).length === 0) {
    return getReminderPrefs(input.userId, client);
  }

  const [row] = await client
    .update(users)
    .set(patch)
    .where(eq(users.id, input.userId))
    .returning(reminderPrefsColumns);

  if (!row) throw new Error("user not found");
  return row;
}
