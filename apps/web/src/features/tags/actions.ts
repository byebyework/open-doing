"use server";

import type { Tag, TagColor, TagType, Task } from "@open-doing/types";
import { eq } from "drizzle-orm";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { db } from "@/server/db/client";
import { projects, tasks } from "@/server/db/schema";
import { DomainError } from "@/lib/domain-error";
import { standardFailuresForRequest } from "@/lib/action-failure";

import { createTag, deleteTag, updateTag } from "./service";
import { setTeamTaskTags } from "@/features/tasks/service";
import { setPersonalTaskTags } from "@/features/personal/tasks/service";

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
  /** 标签类型；缺省 'task'。 */
  type?: TagType;
  /** 可选描述；`null` = 未填写。 */
  description?: string | null;
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
  /** 可选描述；`null` 清空。类型不可改（刻意不接受 type）。 */
  description?: string | null;
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

/**
 * 任务打标（详情页即改即存）：按任务归属路由——团队任务走
 * `setTeamTaskTags`（task:edit 权限），个人任务走 `setPersonalTaskTags`
 * （owner-only）。全量覆写语义；仅标签变更不推进 updated_at。
 */
export async function setTaskTagsAction(input: {
  taskId: string;
  tagIds: string[];
}): Promise<ActionResult<Task>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const [row] = await db
      .select({
        spaceType: tasks.spaceType,
        teamId: projects.teamId,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, input.taskId))
      .limit(1);

    if (!row) {
      throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
    }

    if (row.spaceType === "team") {
      if (!row.teamId) {
        throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
      }
      const task = await setTeamTaskTags({
        teamId: row.teamId,
        taskId: input.taskId,
        actorId: user.id,
        tagIds: input.tagIds,
      });
      return { ok: true, data: task };
    }

    const task = await setPersonalTaskTags({
      taskId: input.taskId,
      actorId: user.id,
      tagIds: input.tagIds,
    });
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error);
  }
}
