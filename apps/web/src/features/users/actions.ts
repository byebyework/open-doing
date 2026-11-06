"use server";

import type { Gender } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  normalizeLocale,
} from "@/i18n/config";
import { cookies } from "next/headers";

import {
  updateUserLanguage,
  updateProfile,
  updateReminderPrefs,
  UserError,
  type ReminderPrefs,
  type UserProfile,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

/**
 * 更新当前会话用户的提醒开关。
 *
 * 个人设置页调用；未登录直接返回表单错误、不重定向（与 auth actions 一致）。
 * `userId` 一律取自会话，调用方无法指定他人 ID——只允许改自己的设置。
 */
export async function updateReminderPrefsAction(input: {
  dueSoonReminderEnabled?: boolean;
  overdueReminderEnabled?: boolean;
}): Promise<ActionResult<ReminderPrefs>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  // 只接受布尔值，忽略其它类型，避免把畸形入参写进数据库。
  const patch: {
    dueSoonReminderEnabled?: boolean;
    overdueReminderEnabled?: boolean;
  } = {};
  if (typeof input?.dueSoonReminderEnabled === "boolean") {
    patch.dueSoonReminderEnabled = input.dueSoonReminderEnabled;
  }
  if (typeof input?.overdueReminderEnabled === "boolean") {
    patch.overdueReminderEnabled = input.overdueReminderEnabled;
  }

  try {
    const prefs = await updateReminderPrefs({ userId: user.id, ...patch });
    return { ok: true, data: prefs };
  } catch (error) {
    console.error("[users] Server Action 执行失败", error);
    return (await standardFailuresForRequest()).custom("settings.saveFailed");
  }
}

/**
 * 切换当前会话用户的界面语言（账号级偏好）。
 *
 * DB 是唯一权威（多设备下一请求即生效）；同时写 od_locale cookie 供
 * 未登录页与首屏渲染使用。非法语言值不触达 service。
 */
export async function updateLanguageAction(input: {
  language: string;
}): Promise<ActionResult<void>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  const language = normalizeLocale(input?.language);
  if (input?.language !== language) {
    return { ok: false, errors: { form: "暂不支持的语言" } };
  }

  try {
    await updateUserLanguage({ userId: user.id, language });
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, language, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("[users] 切换语言失败", error);
    return (await standardFailuresForRequest()).custom("settings.saveFailed");
  }
}

/**
 * 表单入参 → 领域更新入参：字符串按「空 = 未填」语义归一化。
 *
 * 昵称留空时省略该键（service 保持当前昵称）；其它资料留空时显式传
 * `null`（service 清空该列）。性别取值合法性由 service 校验——非法值
 * 必须被拒绝而不是写库，因此这里只 trim，不在此处做枚举判断。
 */
function buildProfileUpdateInput(input: {
  nickname?: string;
  gender?: string;
  email?: string;
  phone?: string;
}): Partial<UserProfile> {
  const nickname =
    typeof input?.nickname === "string" ? input.nickname.trim() : "";
  const gender = typeof input?.gender === "string" ? input.gender.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  const phone = typeof input?.phone === "string" ? input.phone.trim() : "";

  const patch: Partial<UserProfile> = {
    gender: gender ? (gender as Gender) : null,
    email: email || null,
    phone: phone || null,
  };
  if (nickname) patch.nickname = nickname;
  return patch;
}

/**
 * 更新当前会话用户的个人资料（昵称 / 性别 / 邮箱 / 电话）。
 *
 * 个人设置页调用；未登录直接返回表单错误、不重定向（与其它个人设置
 * action 一致）。`userId` 一律取自会话，调用方无法指定他人 ID——只允许
 * 改自己的资料。UserError 的 i18n key 经 `users.profile.*` 翻译后落到
 * 对应字段；未知错误只返回通用提示。
 */
export async function updateProfileAction(input: {
  nickname?: string;
  gender?: string;
  email?: string;
  phone?: string;
}): Promise<ActionResult<UserProfile>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const profile = await updateProfile({
      userId: user.id,
      ...buildProfileUpdateInput(input ?? {}),
    });
    return { ok: true, data: profile };
  } catch (error) {
    // 面向用户的 UserError 均携带 i18n key；其余（含内部 "user not found"）
    // 一律落通用提示，不把服务端细节透传给客户端。
    if (error instanceof UserError && error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field]: failures.custom(
            `users.profile.${error.i18n.key}`,
            error.i18n.params,
          ).errors.form!,
        },
      };
    }

    console.error("[users] 更新个人资料失败", error);
    return (await standardFailuresForRequest()).custom("users.profile.saveFailed");
  }
}
