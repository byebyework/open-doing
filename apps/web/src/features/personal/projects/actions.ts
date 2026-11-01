"use server";

import type { Project } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/session";
import { DomainError } from "@/lib/domain-error";

import {
  createPersonalProject,
  deletePersonalProject,
  updatePersonalProject,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * 复用 auth 的 `ActionResult` 契约，个人空间所有 Server Action 返回值一致。
 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    // 个人项目领域文案在 personal 命名空间；无 i18n 通道时回退 message（zh 兜底）。
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`personal.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }

  console.error("[personal/projects] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/**
 * 创建个人项目。
 *
 * `requireUser()` 在 try 之外调用：未登录时 `redirect()` 抛出的
 * NEXT_REDIRECT 必须继续向上冒泡，不能被错误映射吞掉。
 */
export async function createPersonalProjectAction(input: {
  name: string;
  description?: string;
}): Promise<ActionResult<Project>> {
  const user = await requireUser();

  try {
    const project = await createPersonalProject(user.id, input);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新个人项目（仅本人；slug 保持不变）。 */
export async function updatePersonalProjectAction(
  projectId: string,
  input: { name?: string; description?: string },
): Promise<ActionResult<Project>> {
  const user = await requireUser();

  try {
    const project = await updatePersonalProject(user.id, projectId, input);
    return { ok: true, data: project };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除个人项目（仅本人；项目内任务由数据库级联删除）。 */
export async function deletePersonalProjectAction(
  projectId: string,
): Promise<ActionResult<true>> {
  const user = await requireUser();

  try {
    await deletePersonalProject(user.id, projectId);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}
