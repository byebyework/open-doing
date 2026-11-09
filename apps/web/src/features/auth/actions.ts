"use server";

import type { User } from "@open-doing/types";

import { mapAuthError } from "./auth-error";
import { normalizeRegistrationCode } from "./registration-codes";
import {
  AuthError,
  changePassword,
  login,
  logout,
  toRegisteredUser,
  validateRegistration,
  type AuthInput,
} from "./service";
import { auth } from "./server";
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

/**
 * 注册（封测：必须凭有效注册码）。
 *
 * - 先做自有校验/归一化（注册码必填、邮箱必填且合法、用户名/密码长度、
 *   昵称 ≤50、性别枚举、手机号格式），失败直接落对应字段；
 * - 再调用 better-auth 的 userName 注册端点（`signUpEmail` 携带
 *   `username`；1.7.18 的 username 插件没有独立的 signUpUsername API）；
 * - 注册码校验/消费、uid/name/displayUsername 兜底全部在 better-auth
 *   hooks（hooks.ts）内完成；
 * - better-auth 错误码经 `mapAuthError` 映射为字段错误，未知错误回落
 *   `registerFailed`，绝不透出英文原文；
 * - 注册成功后 better-auth 自动创建会话并通过 nextCookies 写 cookie。
 */
export async function registerAction(input: AuthInput): Promise<ActionResult<User>> {
  try {
    const registrationCode = normalizeRegistrationCode(input?.registrationCode);
    if (!registrationCode) {
      throw new AuthError("VALIDATION", "请输入注册码", "registrationCode", {
        key: "registrationCodeRequired",
      });
    }

    const validated = validateRegistration(input);

    // 先存为变量再传入：signUpEmail 的入参类型来自插件的 body schema，不声明
    // `registrationCode`（运行时由 `.and(z.record(z.any()))` 放行）；对象字面量会
    // 触发多余属性检查，变量形式可保留该字段并直接交给请求钩子读取。
    const signUpBody = {
      email: validated.email,
      password: validated.password,
      name: validated.nickname ?? "",
      username: validated.username,
      registrationCode,
      ...(validated.gender ? { gender: validated.gender } : {}),
      ...(validated.phone ? { phone: validated.phone } : {}),
    };

    const result = await auth.api.signUpEmail({ body: signUpBody });

    return { ok: true, data: toRegisteredUser(result.user) };
  } catch (error) {
    const mapped = await mapAuthError(error);
    if (mapped) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [mapped.field]: failures.custom(`auth.${mapped.i18nKey}`).errors.form!,
        },
      };
    }
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
