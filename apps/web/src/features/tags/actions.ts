"use server";

import type { Tag, TagColor } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";
import { standardFailuresForRequest } from "@/lib/action-failure";

import { createTag, deleteTag, updateTag } from "./service";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 领域错误 -> 字段错误（tags 命名空间）；权限错误 -> 表单级 403 文案；
 * 未知错误只返回通用提示，避免泄露内部信息。
 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`tags.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }
  if (error instanceof TeamPermissionError) {
    return (await standardFailuresForRequest()).forbidden();
  }

  console.error("[tags] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/** 归一化空间入参：`teamId` 传了走团队分支，缺省即个人空间（ownerId = 会话用户）。 */
function withSpace(
  user: { id: string },
  input: { teamId?: string },
): { teamId?: string; ownerId?: string; actorId: string } {
  return input.teamId
    ? { teamId: input.teamId, actorId: user.id }
    : { ownerId: user.id, actorId: user.id };
}

/** 新建标签（团队空间 owner/admin；个人空间本人）。 */
export async function createTagAction(input: {
  teamId?: string;
  name: string;
  color: TagColor;
}): Promise<ActionResult<Tag>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const tag = await createTag({ ...withSpace(user, input), name: input.name, color: input.color });
    return { ok: true, data: tag };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新标签（改名 / 换色；未传字段保持不变）。 */
export async function updateTagAction(input: {
  teamId?: string;
  tagId: string;
  name?: string;
  color?: TagColor;
}): Promise<ActionResult<Tag>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const tag = await updateTag({ ...withSpace(user, input), tagId: input.tagId, name: input.name, color: input.color });
    return { ok: true, data: tag };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除标签（task_tags 外键级联清理）。 */
export async function deleteTagAction(input: {
  teamId?: string;
  tagId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    await deleteTag({ ...withSpace(user, input), tagId: input.tagId });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}
