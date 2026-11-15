"use server";

import type { Team } from "@open-doing/types";

import { getCurrentUser } from "@/features/auth/session";
import type { ActionResult } from "@/features/auth/actions";
import { TeamPermissionError } from "./permissions";

import { TeamError, createTeam, renameTeam, type CreateTeamInput } from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

export type { CreateTeamInput } from "./service";

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * TeamError 携带 i18n 通道时按请求语言翻译（落对应字段）；否则回退
 * message（zh 兜底）。`fallbackKey` 是 `teams` 命名空间的兜底文案 key。
 */
async function toFailure(
  error: unknown,
  fallbackKey: "createFailed" | "renameFailed",
): Promise<{ ok: false; errors: Record<string, string> }> {
  if (error instanceof TeamError) {
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

  console.error("[teams] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).custom(`teams.${fallbackKey}`);
}

/**
 * 运行时校验团队类型。
 *
 * 入参来自客户端，TS 类型不构成安全边界：越界值必须在写库前拒绝。
 */
function assertValidKind(kind: unknown): void {
  if (kind !== undefined && kind !== "real" && kind !== "virtual") {
    throw new TeamError("VALIDATION", "团队类型无效", "kind", {
      key: "kindInvalid",
    });
  }
}

/** 创建团队：成功后创建者即为 owner。 */
export async function createTeamAction(
  input: CreateTeamInput,
): Promise<ActionResult<Team>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    // 以 unknown 读取，确保运行时校验不被 TS 收窄成恒真。
    const kind: unknown = input?.kind;
    assertValidKind(kind);

    const team = await createTeam(input, user.id);
    return { ok: true, data: team };
  } catch (error) {
    return toFailure(error, "createFailed");
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
      return (await standardFailuresForRequest()).notLoggedIn();
    }

    const team = await renameTeam({ teamId: input.teamId, actorId: user.id, name: input.name });
    return { ok: true, data: team };
  } catch (error) {
    return toFailure(error, "renameFailed");
  }
}
