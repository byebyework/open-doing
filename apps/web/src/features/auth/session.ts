import type { User } from "@open-doing/types";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { toDomainUser } from "@/features/users/service";

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
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ? toDomainUser(session.user) : null;
});

/** 受保护页面/布局使用：未登录重定向到 /login。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
