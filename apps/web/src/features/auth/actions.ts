"use server";

import type { User } from "@open-doing/types";

import {
  AuthError,
  login,
  logout,
  registerUser,
  type AuthInput,
} from "./service";
import { createSession } from "./session";

/**
 * Server Action 统一返回值（全仓复用）：
 * - 成功：`{ ok: true, data }`
 * - 失败：`{ ok: false, errors }`，键为字段名或 `form`，值为中文错误文案
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string> };

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
function toFailure(error: unknown, fallback: string): { ok: false; errors: Record<string, string> } {
  if (error instanceof AuthError) {
    return { ok: false, errors: { [error.field]: error.message } };
  }

  console.error("[auth] Server Action 执行失败", error);
  return { ok: false, errors: { form: fallback } };
}

export async function registerAction(input: AuthInput): Promise<ActionResult<User>> {
  try {
    const user = await registerUser(input);
    await createSession(user.id);
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, "注册失败，请稍后重试");
  }
}

export async function loginAction(input: AuthInput): Promise<ActionResult<User>> {
  try {
    const user = await login(input);
    await createSession(user.id);
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, "登录失败，请稍后重试");
  }
}

export async function logoutAction(): Promise<ActionResult<true>> {
  try {
    await logout();
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error, "退出登录失败，请稍后重试");
  }
}
