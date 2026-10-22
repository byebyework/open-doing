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

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 领域错误 -> 字段错误；未知错误只返回通用提示，避免泄露内部信息。
 *
 * 复用 auth 的 `ActionResult` 契约，个人空间所有 Server Action 返回值一致。
 */
function toFailure(error: unknown): Failure {
  if (error instanceof DomainError) {
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }

  console.error("[personal/projects] Server Action 执行失败", error);
  return { ok: false, errors: { form: "操作失败，请稍后重试" } };
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
