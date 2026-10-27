"use server";

import type { TeamJoinRequest } from "@open-doing/types";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";

import {
  JoinError,
  cancelJoinRequest,
  createJoinRequest,
  resetJoinCode,
  respondToJoinRequest,
  setJoinCodeEnabled,
} from "./service";

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
function toFailure(error: unknown, fallback: string): { ok: false; errors: Record<string, string> } {
  if (error instanceof JoinError) {
    // field 为 "code" 时落表单入群码字段，为 "form" 时落在表单顶部。
    return { ok: false, errors: { [error.field]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return { ok: false, errors: { form: "没有权限执行该操作" } };
  }

  console.error("[teams/joins] Server Action 执行失败", error);
  return { ok: false, errors: { form: fallback } };
}

/** 凭入群码发起加入申请（任何已登录用户）。 */
export async function createJoinRequestAction(input: {
  code: string;
}): Promise<ActionResult<TeamJoinRequest>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const request = await createJoinRequest({ code: input.code, actorId: user.id });

    // 审批队列（团队设置页）与「我的申请」（邀请页）随申请变化刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: request };
  } catch (error) {
    return toFailure(error, "提交加入申请失败，请稍后重试");
  }
}

/** 审批加入申请（owner/admin）。 */
export async function respondToJoinRequestAction(input: {
  requestId: string;
  approve: boolean;
}): Promise<ActionResult<TeamJoinRequest>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const request = await respondToJoinRequest({
      requestId: input.requestId,
      actorId: user.id,
      approve: input.approve,
    });

    // 批准可能新增成员：侧栏「我的团队」与申请双方页面一并刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: request };
  } catch (error) {
    return toFailure(error, "处理加入申请失败，请稍后重试");
  }
}

/** 申请人撤回自己的待处理申请。 */
export async function cancelJoinRequestAction(input: {
  requestId: string;
}): Promise<ActionResult<TeamJoinRequest>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const request = await cancelJoinRequest({ requestId: input.requestId, actorId: user.id });

    // 撤回后审批队列与「我的申请」同步刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: request };
  } catch (error) {
    return toFailure(error, "撤回加入申请失败，请稍后重试");
  }
}

/** 重置入群码（owner/admin）；旧码立即失效。 */
export async function resetJoinCodeAction(input: {
  teamId: string;
}): Promise<ActionResult<{ joinCode: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const joinCode = await resetJoinCode({ teamId: input.teamId, actorId: user.id });

    // 设置页展示新码。
    revalidatePath("/", "layout");
    return { ok: true, data: { joinCode } };
  } catch (error) {
    return toFailure(error, "重置入群码失败，请稍后重试");
  }
}

/** 开关凭码加入（owner/admin）。 */
export async function setJoinCodeEnabledAction(input: {
  teamId: string;
  enabled: boolean;
}): Promise<ActionResult<{ joinCodeEnabled: boolean }>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    await setJoinCodeEnabled({
      teamId: input.teamId,
      actorId: user.id,
      enabled: input.enabled,
    });

    // 设置页开关状态随之刷新；返回当前开关值供乐观更新校准。
    revalidatePath("/", "layout");
    return { ok: true, data: { joinCodeEnabled: input.enabled } };
  } catch (error) {
    return toFailure(error, "保存入群设置失败，请稍后重试");
  }
}
