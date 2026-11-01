"use server";

import type { Project } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";

import {
  createTeamProject,
  deleteTeamProject,
  updateTeamProject,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/** 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    // 项目领域文案在 projects 命名空间；无 i18n 通道时回退 message（zh 兜底）。
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`projects.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return (await standardFailuresForRequest()).forbidden();
  }

  console.error("[projects] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/** 创建团队项目（仅 owner/admin，服务层再次校验）。 */
export async function createTeamProjectAction(input: {
  teamId: string;
  name: string;
  description?: string;
}): Promise<ActionResult<Project>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const project = await createTeamProject({ ...input, actorId: user.id });
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 修改团队项目（仅 owner/admin）；slug 不变。 */
export async function updateTeamProjectAction(input: {
  teamId: string;
  projectId: string;
  name?: string;
  description?: string;
}): Promise<ActionResult<Project>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    const project = await updateTeamProject({ ...input, actorId: user.id });
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除团队项目（仅 owner/admin）；任务 / 子任务 / 评论 / 通知级联删除。 */
export async function deleteTeamProjectAction(input: {
  teamId: string;
  projectId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) {
    return (await standardFailuresForRequest()).notLoggedIn();
  }

  try {
    await deleteTeamProject({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}
