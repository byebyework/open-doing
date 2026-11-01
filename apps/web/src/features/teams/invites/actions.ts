"use server";

import type { Team, TeamInvite } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";

import {
  InviteError,
  createInvite,
  rescindInvite,
  respondToInvite,
  type CreateInviteInput,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

export type { CreateInviteInput } from "./service";

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * InviteError 携带 i18n 通道时按请求语言翻译（落对应字段）；否则回退
 * message（zh 兜底）。`fallbackKey` 是 `teams` 命名空间的兜底文案 key。
 */
async function toFailure(
  error: unknown,
  fallbackKey: "inviteSendFailed" | "inviteRescindFailed" | "inviteRespondFailed",
): Promise<{ ok: false; errors: Record<string, string> }> {
  if (error instanceof InviteError) {
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field]: failures.custom(`teams.${error.i18n.key}`, error.i18n.params)
            .errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return (await standardFailuresForRequest()).forbidden();
  }

  console.error("[teams/invites] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).custom(`teams.${fallbackKey}`);
}

/** 按 UID 发起邀请（owner/admin）。 */
export async function createInviteAction(
  input: CreateInviteInput,
): Promise<ActionResult<TeamInvite>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const invite = await createInvite({ ...input, actorId: user.id });
    return { ok: true, data: invite };
  } catch (error) {
    return toFailure(error, "inviteSendFailed");
  }
}

/** 撤销待处理邀请（owner/admin）。 */
export async function rescindInviteAction(
  input: { inviteId: string; teamId: string },
): Promise<ActionResult<TeamInvite>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const invite = await rescindInvite({ ...input, actorId: user.id });
    return { ok: true, data: invite };
  } catch (error) {
    return toFailure(error, "inviteRescindFailed");
  }
}

/** 被邀请人接受 / 拒绝邀请。 */
export async function respondToInviteAction(
  input: { inviteId: string; accept: boolean },
): Promise<ActionResult<Team>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await respondToInvite({ inviteId: input.inviteId, actorId: user.id, accept: input.accept });
    return { ok: true, data: team };
  } catch (error) {
    return toFailure(error, "inviteRespondFailed");
  }
}
