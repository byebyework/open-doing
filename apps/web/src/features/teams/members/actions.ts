"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { getMembership, TeamPermissionError } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";

import { MemberError, leaveTeam, removeMember } from "./service";

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
function toFailure(error: unknown, fallback: string): { ok: false; errors: Record<string, string> } {
  if (error instanceof MemberError) {
    return { ok: false, errors: { [error.field]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    // 策略性文案（如「请先转让团队或解散团队」）原样透出。
    return { ok: false, errors: { form: error.message } };
  }

  console.error("[teams/members] Server Action 执行失败", error);
  return { ok: false, errors: { form: fallback } };
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
      return { ok: false, errors: { form: "请先登录" } };
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return { ok: false, errors: { form: "团队不存在或无权访问" } };
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
    return toFailure(error, "移除成员失败，请稍后重试");
  }
}

/** 主动退出团队（admin/member；owner 须先转让或解散）。 */
export async function leaveTeamAction(input: { teamSlug: string }): Promise<ActionResult<null>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const team = await resolveTeamForActor(input.teamSlug, user.id);
    if (!team) {
      return { ok: false, errors: { form: "团队不存在或无权访问" } };
    }

    await leaveTeam({ teamId: team.id, actorId: user.id });

    revalidatePath("/", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return toFailure(error, "退出团队失败，请稍后重试");
  }
}
