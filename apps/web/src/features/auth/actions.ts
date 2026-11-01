"use server";

import type { User } from "@open-doing/types";

import {
  AuthError,
  changePassword,
  login,
  logout,
  registerUser,
  type AuthInput,
} from "./service";
import { createSession, getCurrentUser } from "./session";
import { standardFailuresForRequest } from "@/lib/action-failure";

/**
 * Server Action 统一返回值（全仓复用）：
 * - 成功：`{ ok: true, data }`
 * - 失败：`{ ok: false, errors }`，键为字段名或 `form`，值为按用户语言翻译的错误文案
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string> };

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * AuthError 携带 i18n 通道时按请求语言翻译（落对应字段）；否则回退
 * message（zh 兜底）。`fallbackKey` 是 `auth` 命名空间的兜底文案 key。
 */
async function toFailure(
  error: unknown,
  fallbackKey: "registerFailed" | "loginFailed" | "changePasswordFailed" | "signOutFailed",
): Promise<{ ok: false; errors: Record<string, string> }> {
  if (error instanceof AuthError) {
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field]: failures.custom(`auth.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field]: error.message } };
  }

  console.error("[auth] Server Action 执行失败", error);
  const failures = await standardFailuresForRequest();
  return failures.custom(`auth.${fallbackKey}`);
}

export async function registerAction(input: AuthInput): Promise<ActionResult<User>> {
  try {
    const user = await registerUser(input);
    await createSession(user.id);
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, "registerFailed");
  }
}

export async function loginAction(input: AuthInput): Promise<ActionResult<User>> {
  try {
    const user = await login(input);
    await createSession(user.id);
    return { ok: true, data: user };
  } catch (error) {
    return toFailure(error, "loginFailed");
  }
}

/**
 * 修改当前会话用户的密码。
 *
 * 个人设置页调用；未登录直接返回表单错误、不重定向。成功返回
 * `true`，会话不变（无状态 JWT），用户保持登录。
 */
export async function changePasswordAction(input: {
  oldPassword: string;
  newPassword: string;
}): Promise<ActionResult<true>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    await changePassword({
      userId: user.id,
      oldPassword: input?.oldPassword,
      newPassword: input?.newPassword,
    });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error, "changePasswordFailed");
  }
}

export async function logoutAction(): Promise<ActionResult<true>> {
  try {
    await logout();
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error, "signOutFailed");
  }
}
