import type { User } from "@open-doing/types";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUserById } from "@/features/users/service";

/**
 * 会话决策（ARCHITECTURE §3 认证行）：
 * - jose HS256 签名的**无状态** httpOnly cookie，不建 sessions 表；
 * - 免查库校验签名（取用户时才按 userId 查询一次）、免会话清理任务；
 * - payload 仅含 `{ userId }`，30 天有效；密钥来自 `SESSION_SECRET`。
 */
export const SESSION_COOKIE_NAME = "od_session";

/** 30 天（秒）。 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** httpOnly + lax + 根路径；生产环境自动加 secure。 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
} as const;

/**
 * 读取会话签名密钥。
 *
 * 生产环境必须显式配置；开发/测试环境回退到固定开发密钥，
 * 避免本地未建 `.env.local` 时整站不可用（生产缺失会直接报错）。
 */
export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (secret) return new TextEncoder().encode(secret);

  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 SESSION_SECRET 环境变量");
  }

  return new TextEncoder().encode("open-doing-dev-only-session-secret");
}

/** 签发 30 天有效的 HS256 token（payload: `{ userId }`）。 */
export async function signSessionToken(
  userId: string,
  secret: Uint8Array = getSessionSecret(),
): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

/**
 * 校验 token 并返回 userId；签名/过期/结构不合法均抛错。
 *
 * 显式限定 HS256，防止算法混淆攻击。
 */
export async function verifySessionToken(
  token: string,
  secret: Uint8Array = getSessionSecret(),
): Promise<string> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });

  if (typeof payload.userId !== "string" || payload.userId.length === 0) {
    throw new Error("会话 token 缺少 userId");
  }

  return payload.userId;
}

/** 登录成功后写入会话 cookie（只能在 Server Action / Route Handler 调用）。 */
export async function createSession(userId: string): Promise<void> {
  const token = await signSessionToken(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
}

/** 读取当前会话的 userId；无 token 或校验失败均返回 null。 */
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

/** 清除会话 cookie（登出）。 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}

/** 当前登录用户；未登录或用户已被删除返回 null。 */
export async function getCurrentUser(): Promise<User | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;

  return getUserById(userId);
}

/** 受保护页面/布局使用：未登录重定向到 /login。 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
