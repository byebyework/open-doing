import type { User } from "@open-doing/types";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { toDomainUser } from "@/features/users/service";
import { db } from "@/server/db/client";
import { sessions } from "@/server/db/schema";

import { auth } from "./server";

/**
 * 会话决策（better-auth 数据库会话）：
 * - 会话本体由 better-auth 的 `sessions` 表维护，cookie 仅携带签名后的 token；
 * - `auth.api.getSession` 读取请求头里的 cookie 并查库校验，30 天过期由
 *   server.ts 的 `session.expiresIn` 统一配置；
 * - 改密（`revokeOtherSessions: true`）会删除所有旧会话并下发新会话 cookie。
 *
 * 旧 jose 无状态会话（SESSION_COOKIE_* / signSessionToken / verifySessionToken /
 * createSession / clearSession / getSessionUserId / getSessionSecret）已全部移除。
 */

/**
 * 当前登录用户；未登录、会话过期或用户已被删除返回 null。
 * 按请求缓存：同一请求内 requireUser / i18n locale 解析等多次调用只查一次。
 *
 * 被禁用（`isDisabled`）的账号视为强制下线：删除该用户全部 `sessions` 行并
 * 返回 null。即使旧 cookie 仍在客户端，其会话行已不存在，后续请求一律未登录。
 * 登录入口本身也已拒绝禁用账号（见 hooks.ts），此处兜底已在线会话。
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const user = toDomainUser(session.user);
  if (user.isDisabled) {
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    return null;
  }

  return user;
});

/** 受保护页面/布局使用：未登录重定向到 /login。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
