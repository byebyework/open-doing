"use server";

import type { TeamInvite } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";

import { InviteError, createInvite, rescindInvite, type CreateInviteInput } from "./service";

export type { CreateInviteInput } from "./service";

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
function toFailure(error: unknown, fallback: string): { ok: false; errors: Record<string, string> } {
  if (error instanceof InviteError) {
    return { ok: false, errors: { [error.field]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return { ok: false, errors: { form: "没有权限执行该操作" } };
  }

  console.error("[teams/invites] Server Action 执行失败", error);
  return { ok: false, errors: { form: fallback } };
}

/** 按 UID 发起邀请（owner/admin）。 */
export async function createInviteAction(
  input: CreateInviteInput,
): Promise<ActionResult<TeamInvite>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const invite = await createInvite({ ...input, actorId: user.id });
    return { ok: true, data: invite };
  } catch (error) {
    return toFailure(error, "发送邀请失败，请稍后重试");
  }
}

/** 撤销待处理邀请（owner/admin）。 */
export async function rescindInviteAction(
  input: { inviteId: string; teamId: string },
): Promise<ActionResult<TeamInvite>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const invite = await rescindInvite({ ...input, actorId: user.id });
    return { ok: true, data: invite };
  } catch (error) {
    return toFailure(error, "撤销邀请失败，请稍后重试");
  }
}
