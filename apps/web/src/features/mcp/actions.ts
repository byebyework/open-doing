"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { VirtualMemberError } from "@/features/teams/virtual/service";
import { standardFailuresForRequest } from "@/lib/action-failure";

import { issueApiToken, revokeApiToken } from "./api-tokens";

/** 签发成功返回：原文只在此处出现一次，界面弹窗关闭后不再保留。 */
export interface IssuedApiToken {
  token: string;
  tokenPrefix: string;
}

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * API Token 的鉴权复用虚拟成员领域错误（`teams` 命名空间），按请求语言
 * 翻译后落对应字段；`fallbackKey` 是 `mcp.tokens` 命名空间的兜底文案 key。
 */
async function toFailure(
  error: unknown,
  fallbackKey: "issueFailed" | "revokeFailed",
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

  console.error("[mcp] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).custom(`mcp.tokens.${fallbackKey}`);
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

/**
 * 签发（或重新签发）虚拟成员的 API Token（owner/admin；仅虚拟团队）。
 *
 * 重签即轮换：service 先删旧行再写新行，旧原文立即失效。
 * `data.token` 是唯一一次可见的原文；token 列表由 `router.refresh()` 从
 * RSC 重新读取（只含前缀）。
 */
export async function issueApiTokenAction(input: {
  teamSlug: string;
  virtualMemberId: string;
}): Promise<ActionResult<IssuedApiToken>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return (await standardFailuresForRequest()).custom("teams.teamNotFoundOrForbidden");
    }

    const issued = await issueApiToken({
      virtualMemberId: input.virtualMemberId,
      actorId: user.id,
    });

    // 设置页 Token 列表随服务端数据刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: issued };
  } catch (error) {
    return toFailure(error, "issueFailed");
  }
}

/** 吊销虚拟成员的 API Token（owner/admin；仅虚拟团队）。本来没有也算成功。 */
export async function revokeApiTokenAction(input: {
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

    await revokeApiToken({
      virtualMemberId: input.virtualMemberId,
      actorId: user.id,
    });

    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "revokeFailed");
  }
}
