"use server";

import type { Team } from "@open-doing/types";

import { getCurrentUser } from "@/features/auth/session";
import type { ActionResult } from "@/features/auth/actions";
import { TeamPermissionError } from "./permissions";

import { TeamError, createTeam, renameTeam, type CreateTeamInput } from "./service";

export type { CreateTeamInput } from "./service";

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
function toFailure(error: unknown, fallback: string): { ok: false; errors: Record<string, string> } {
  if (error instanceof TeamError) {
    return { ok: false, errors: { [error.field]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return { ok: false, errors: { form: "没有权限执行该操作" } };
  }

  console.error("[teams] Server Action 执行失败", error);
  return { ok: false, errors: { form: fallback } };
}

/** 创建团队：成功后创建者即为 owner。 */
export async function createTeamAction(
  input: CreateTeamInput,
): Promise<ActionResult<Team>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const team = await createTeam(input, user.id);
    return { ok: true, data: team };
  } catch (error) {
    return toFailure(error, "创建团队失败，请稍后重试");
  }
}

/** 修改团队名称（owner/admin）；slug 保持不变。 */
export async function renameTeamAction(input: {
  teamId: string;
  name: string;
}): Promise<ActionResult<Team>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, errors: { form: "请先登录" } };
    }

    const team = await renameTeam({ teamId: input.teamId, actorId: user.id, name: input.name });
    return { ok: true, data: team };
  } catch (error) {
    return toFailure(error, "保存团队信息失败，请稍后重试");
  }
}
