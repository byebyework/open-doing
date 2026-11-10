"use server";

import type { User } from "@open-doing/types";
import { headers } from "next/headers";

import { mapAuthError, readAuthErrorCode } from "./auth-error";
import { normalizeRegistrationCode } from "./registration-codes";
import {
  AuthError,
  validateRegistration,
  type AuthInput,
} from "./service";
import { auth } from "./server";
import { getCurrentUser } from "./session";
import { standardFailuresForRequest } from "@/lib/action-failure";
import { toDomainUser } from "@/features/users/service";

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

    return { ok: true, data: toDomainUser(result.user) };
  } catch (error) {
    const mapped = await mapAuthError(error);
    if (mapped) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [mapped.field]: failures.custom(
            `auth.${mapped.i18nKey}`,
            mapped.params,
          ).errors.form!,
        },
      };
    }
    return toFailure(error, "registerFailed");
  }
}

/**
 * 登录（better-auth username 插件）。
 *
 * 不存在的用户名与错误密码统一映射为 `auth.invalidCredentials`，
 * 防止通过错误信息枚举已注册用户名；未知错误同样回落到该文案。
 * `signInUsername` 成功后会创建 sessions 行并由 nextCookies 写入
 * 会话 cookie，登录后的下一个请求即可通过 `getCurrentUser` 识别。
 */
export async function loginAction(
  input: Pick<AuthInput, "username" | "password">,
): Promise<ActionResult<User>> {
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";

  if (!username || !password) {
    return (await standardFailuresForRequest()).custom("auth.invalidCredentials");
  }

  try {
    const result = await auth.api.signInUsername({
      body: { username, password },
      headers: await headers(),
    });
    return { ok: true, data: toDomainUser(result.user) };
  } catch (error) {
    const mapped = await mapAuthError(error);
    if (mapped) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [mapped.field]: failures.custom(
            `auth.${mapped.i18nKey}`,
            mapped.params,
          ).errors.form!,
        },
      };
    }

    console.error("[auth] 登录失败", error);
    return (await standardFailuresForRequest()).custom("auth.invalidCredentials");
  }
}

/**
 * 修改当前会话用户的密码（better-auth `changePassword`）。
 *
 * 个人设置页调用；未登录直接返回表单错误、不重定向。
 * `revokeOtherSessions: true` 删除该用户的所有旧会话并下发新会话 cookie：
 * 当前设备保持登录，其它设备上的旧 session 立即失效。
 * 旧密码错误落 `oldPassword`；新密码过短落 `newPassword`。
 */
export async function changePasswordAction(input: {
  oldPassword: string;
  newPassword: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  const currentPassword =
    typeof input?.oldPassword === "string" ? input.oldPassword : "";
  const newPassword =
    typeof input?.newPassword === "string" ? input.newPassword : "";

  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
    return { ok: true, data: true };
  } catch (error) {
    const code = readAuthErrorCode(error);

    // 当前密码错误：better-auth 抛 INVALID_PASSWORD，改密表单落到 oldPassword。
    if (code === "INVALID_PASSWORD") {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          oldPassword: failures.custom("auth.oldPasswordIncorrect").errors.form!,
        },
      };
    }

    const mapped = await mapAuthError(error);
    if (mapped) {
      const failures = await standardFailuresForRequest();
      // 通用映射里密码字段叫 password；改密表单的新密码字段叫 newPassword。
      const field = mapped.field === "password" ? "newPassword" : mapped.field;
      return {
        ok: false,
        errors: {
          [field]: failures.custom(
            `auth.${mapped.i18nKey}`,
            mapped.params,
          ).errors.form!,
        },
      };
    }

    return toFailure(error, "changePasswordFailed");
  }
}

/** 登出：删除当前 sessions 行并清除会话 cookie（better-auth `signOut`）。 */
export async function logoutAction(): Promise<ActionResult<true>> {
  try {
    await auth.api.signOut({ headers: await headers() });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error, "signOutFailed");
  }
}
