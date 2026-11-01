"use server";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";

import { updateReminderPrefs, type ReminderPrefs } from "./service";

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
    return { ok: false, errors: { form: "请先登录" } };
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
    return { ok: false, errors: { form: "设置保存失败，请稍后重试" } };
  }
}
