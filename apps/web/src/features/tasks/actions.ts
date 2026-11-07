"use server";

import type { Comment, Subtask, Task, TaskStatus } from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";

import { TaskPermissionError } from "./permissions";
import {
  addTeamComment,
  addTeamSubtask,
  createTeamTask,
  deleteTeamComment,
  deleteTeamTask,
  removeTeamSubtask,
  toggleTeamSubtask,
  updateTeamTask,
} from "./service";
import { standardFailuresForRequest } from "@/lib/action-failure";

type Failure = Extract<ActionResult<never>, { ok: false }>;

/**
 * 领域错误 -> 字段错误；权限错误 -> 表单级 403 文案；
 * 未知错误只返回通用提示，避免泄露内部信息。
 */
async function toFailure(error: unknown): Promise<Failure> {
  if (error instanceof DomainError) {
    // 团队任务领域文案在 tasks 命名空间；无 i18n 通道时回退 message（zh 兜底）。
    if (error.i18n) {
      const failures = await standardFailuresForRequest();
      return {
        ok: false,
        errors: {
          [error.field ?? "form"]: failures
            .custom(`tasks.${error.i18n.key}`, error.i18n.params).errors.form!,
        },
      };
    }
    return { ok: false, errors: { [error.field ?? "form"]: error.message } };
  }
  if (error instanceof TaskPermissionError || error instanceof TeamPermissionError) {
    return (await standardFailuresForRequest()).forbidden();
  }

  console.error("[tasks] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/** 创建团队任务（任何成员；指派缺省为自己）。 */
export async function createTeamTaskAction(input: {
  teamId: string;
  projectId: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  startDate?: string | null;
  assigneeId?: string | null;
}): Promise<ActionResult<Task>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const task = await createTeamTask({ ...input, actorId: user.id });
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新团队任务（标题 / 描述 / 截止日期 / 开始时间 / 状态 / 责任人）。 */
export async function updateTeamTaskAction(
  taskId: string,
  input: {
    teamId: string;
    title?: string;
    description?: string;
    dueDate?: string | null;
    startDate?: string | null;
    status?: TaskStatus;
    assigneeId?: string;
  },
): Promise<ActionResult<Task>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const task = await updateTeamTask({ taskId, ...input, actorId: user.id });
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除团队任务（owner/admin 任意，member 仅本人任务）。 */
export async function deleteTeamTaskAction(input: {
  teamId: string;
  taskId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    await deleteTeamTask({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 新增子任务。 */
export async function addTeamSubtaskAction(input: {
  teamId: string;
  taskId: string;
  title: string;
}): Promise<ActionResult<Subtask>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const subtask = await addTeamSubtask({ ...input, actorId: user.id });
    return { ok: true, data: subtask };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除子任务。 */
export async function removeTeamSubtaskAction(input: {
  teamId: string;
  taskId: string;
  subtaskId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    await removeTeamSubtask({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 勾选 / 取消勾选子任务（不影响主任务状态）。 */
export async function toggleTeamSubtaskAction(input: {
  teamId: string;
  taskId: string;
  subtaskId: string;
  completed: boolean;
}): Promise<ActionResult<Subtask>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const subtask = await toggleTeamSubtask({ ...input, actorId: user.id });
    return { ok: true, data: subtask };
  } catch (error) {
    return toFailure(error);
  }
}

/** 发表评论（任何成员）。 */
export async function addTeamCommentAction(input: {
  teamId: string;
  taskId: string;
  content: string;
}): Promise<ActionResult<Comment>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    const comment = await addTeamComment({ ...input, actorId: user.id });
    return { ok: true, data: comment };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除评论（仅作者本人）。 */
export async function deleteTeamCommentAction(input: {
  teamId: string;
  taskId: string;
  commentId: string;
}): Promise<ActionResult<true>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    await deleteTeamComment({ ...input, actorId: user.id });
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}
