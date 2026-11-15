"use server";

import type { VirtualMember } from "@open-doing/types";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { standardFailuresForRequest } from "@/lib/action-failure";

import {
  VirtualMemberError,
  createVirtualMember,
  removeVirtualMember,
  updateVirtualMember,
} from "./service";

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * VirtualMemberError 携带 i18n 通道时按请求语言翻译（落对应字段）；
 * 否则回退 message（zh 兜底）。`fallbackKey` 是 `teams` 命名空间的兜底文案 key。
 */
async function toFailure(
  error: unknown,
  fallbackKey:
    | "createVirtualMemberFailed"
    | "updateVirtualMemberFailed"
    | "removeVirtualMemberFailed",
): Promise<{ ok: false; errors: Record<string, string> }> {
  if (error instanceof VirtualMemberError) {
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

  console.error("[teams/virtual] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).custom(`teams.${fallbackKey}`);
}

/**
 * slug -> 团队；不存在或调用者不是成员统一返回同一文案，
 * 不泄露团队是否存在。
 */
async function resolveTeamForActor(teamSlug: string, actorId: string) {
  const team = await getTeamBySlug(teamSlug);
  if (!team) return null;

  const membership = await getMembership(team.id, actorId);
  if (!membership) return null;

  return team;
}

/** 创建虚拟成员（owner/admin；仅虚拟团队）。 */
export async function createVirtualMemberAction(input: {
  teamSlug: string;
  name: string;
  role?: "admin" | "member";
  description?: string;
  accentColor?: string;
}): Promise<ActionResult<VirtualMember>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return (await standardFailuresForRequest()).custom("teams.teamNotFoundOrForbidden");
    }

    const virtualMember = await createVirtualMember({
      teamId: team.id,
      actorId: user.id,
      name: input.name,
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
    });

    // 设置页虚拟成员列表与侧栏团队信息随成员关系刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: virtualMember };
  } catch (error) {
    return toFailure(error, "createVirtualMemberFailed");
  }
}

/** 更新虚拟成员（owner/admin；仅虚拟团队）；只改显式提供的字段。 */
export async function updateVirtualMemberAction(input: {
  teamSlug: string;
  virtualMemberId: string;
  name?: string;
  role?: "admin" | "member";
  description?: string;
  accentColor?: string;
}): Promise<ActionResult<VirtualMember>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return (await standardFailuresForRequest()).custom("teams.teamNotFoundOrForbidden");
    }

    const virtualMember = await updateVirtualMember({
      teamId: team.id,
      virtualMemberId: input.virtualMemberId,
      actorId: user.id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
    });

    revalidatePath("/", "layout");
    return { ok: true, data: virtualMember };
  } catch (error) {
    return toFailure(error, "updateVirtualMemberFailed");
  }
}

/** 移除虚拟成员（owner/admin；仅虚拟团队）。 */
export async function removeVirtualMemberAction(input: {
  teamSlug: string;
  virtualMemberId: string;
}): Promise<ActionResult<null>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return (await standardFailuresForRequest()).custom("teams.teamNotFoundOrForbidden");
    }

    await removeVirtualMember({
      teamId: team.id,
      virtualMemberId: input.virtualMemberId,
      actorId: user.id,
    });

    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "removeVirtualMemberFailed");
  }
}
