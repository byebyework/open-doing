"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { getMembership, TeamPermissionError } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";

import {
  GovernanceError,
  MemberError,
  TeamPolicyError,
  dissolveTeam,
  leaveTeam,
  removeMember,
  transferTeam,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * MemberError / GovernanceError / TeamPolicyError 携带 i18n 通道时按请求
 * 语言翻译（落 form 字段）；否则回退 message（zh 兜底）。
 * `fallbackKey` 是 `teams` 命名空间的兜底文案 key。
 */
async function toFailure(
  error: unknown,
  fallbackKey: "removeFailed" | "leaveFailed" | "transferFailed" | "dissolveFailed",
): Promise<{ ok: false; errors: Record<string, string> }> {
  if (error instanceof MemberError || error instanceof GovernanceError) {
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
  // TeamPolicyError 先于 TeamPermissionError 判定：策略文案走 i18n 通道。
  if (error instanceof TeamPolicyError) {
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          form: failures.custom(`teams.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    // 策略性文案（如「请先转让团队或解散团队」）原样透出。
    return { ok: false, errors: { form: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return (await standardFailuresForRequest()).forbidden();
  }

  console.error("[teams/members] Server Action 执行失败", error);
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

/** 移除团队成员（owner/admin）。 */
export async function removeMemberAction(input: {
  teamSlug: string;
  targetUserId: string;
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

    await removeMember({
      teamId: team.id,
      targetUserId: input.targetUserId,
      actorId: user.id,
    });

    // 侧栏「我的团队」与成员列表随成员关系变化刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "removeFailed");
  }
}

/** 主动退出团队（admin/member；owner 须先转让或解散）。 */
export async function leaveTeamAction(input: { teamSlug: string }): Promise<ActionResult<null>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return (await standardFailuresForRequest()).custom("teams.teamNotFoundOrForbidden");
    }

    await leaveTeam({ teamId: team.id, actorId: user.id });

    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "leaveFailed");
  }
}

/** 转让团队所有权（仅 owner）。 */
export async function transferTeamAction(input: {
  teamSlug: string;
  targetUserId: string;
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

    await transferTeam({
      teamId: team.id,
      targetUserId: input.targetUserId,
      actorId: user.id,
    });

    // 角色与 owner 变化会影响侧栏与设置页分区。
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "transferFailed");
  }
}

/** 解散团队（仅 owner）；成功后由 UI 负责跳转，本 action 只返回 ok。 */
export async function dissolveTeamAction(input: {
  teamSlug: string;
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

    await dissolveTeam({ teamId: team.id, actorId: user.id });

    // 团队已删除：侧栏「我的团队」与所有团队页面随之刷新。
    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "dissolveFailed");
  }
}
