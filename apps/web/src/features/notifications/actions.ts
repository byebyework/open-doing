"use server";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";

import {
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "./queries";

/** 失败结果统一结构；未知错误只返回通用提示，避免泄露内部信息。 */
function failure(message: string): { ok: false; errors: Record<string, string> } {
  return { ok: false, errors: { form: message } };
}

/**
 * 将单条通知置为已读（仅本人）。
 *
 * 通知不存在或不属于当前用户时返回失败，不暴露「存在但不属于你」的信息；
 * 成功后重新统计未读数，供客户端直接更新角标。
 */
export async function markNotificationReadAction(
  notificationId: string,
): Promise<ActionResult<{ unreadCount: number }>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return failure("请先登录");
    }

    const marked = await markNotificationRead({ userId: user.id, notificationId });
    if (!marked) {
      return failure("通知不存在或已被删除");
    }

    const unreadCount = await getUnreadNotificationCount(user.id);
    return { ok: true, data: { unreadCount } };
  } catch (error) {
    console.error("[notifications] 标记通知已读失败", error);
    return failure("操作失败，请稍后重试");
  }
}

/** 将本人全部未读通知置为已读，返回最新未读数（正常为 0）。 */
export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ unreadCount: number }>
> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return failure("请先登录");
    }

    await markAllNotificationsRead(user.id);
    const unreadCount = await getUnreadNotificationCount(user.id);
    return { ok: true, data: { unreadCount } };
  } catch (error) {
    console.error("[notifications] 全部标记已读失败", error);
    return failure("操作失败，请稍后重试");
  }
}
