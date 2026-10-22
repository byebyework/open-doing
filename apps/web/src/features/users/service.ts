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
