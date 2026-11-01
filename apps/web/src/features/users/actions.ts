"use server";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  normalizeLocale,
} from "@/i18n/config";
import { cookies } from "next/headers";

import { updateUserLanguage, updateReminderPrefs, type ReminderPrefs } from "./service";
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
