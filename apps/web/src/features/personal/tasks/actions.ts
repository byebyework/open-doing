"use server";

import type {
  Comment,
  Subtask,
  Task,
  TaskPriority,
  TaskStatus,
} from "@open-doing/types";

import type { ActionResult } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/session";
import { DomainError } from "@/lib/domain-error";

import {
  addPersonalComment,
  addPersonalSubtask,
  createPersonalTask,
  deletePersonalComment,
  deletePersonalTask,
  removePersonalSubtask,
  togglePersonalSubtask,
  updatePersonalTask,
  type PersonalTaskInput,
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
    // 个人任务的领域文案共用 tasks 命名空间；无 i18n 通道时回退 message（zh 兜底）。
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

  console.error("[personal/tasks] Server Action 执行失败", error);
  return (await standardFailuresForRequest()).unexpected();
}

/**
 * 创建个人任务。
 *
 * `requireUser()` 在 try 之外调用：未登录时 `redirect()` 抛出的
 * NEXT_REDIRECT 必须继续向上冒泡，不能被错误映射吞掉。
 */
export async function createPersonalTaskAction(
  input: PersonalTaskInput,
): Promise<ActionResult<Task>> {
  const user = await requireUser();

  try {
    const task = await createPersonalTask(user.id, input);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新个人任务（标题 / 描述 / 优先级 / 截止日期 / 开始时间 / 状态；状态仅经此手动流转）。 */
export async function updatePersonalTaskAction(
  taskId: string,
  input: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    dueDate?: string | null;
    startDate?: string | null;
    status?: TaskStatus;
  },
): Promise<ActionResult<Task>> {
  const user = await requireUser();

  try {
    const task = await updatePersonalTask(user.id, taskId, input);
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除个人任务（仅本人；子任务与评论由数据库级联删除）。 */
export async function deletePersonalTaskAction(
  taskId: string,
): Promise<ActionResult<true>> {
  const user = await requireUser();

  try {
    await deletePersonalTask(user.id, taskId);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 新增子任务。 */
export async function addPersonalSubtaskAction(
  taskId: string,
  title: string,
): Promise<ActionResult<Subtask>> {
  const user = await requireUser();

  try {
    const subtask = await addPersonalSubtask(user.id, taskId, title);
    return { ok: true, data: subtask };
  } catch (error) {
    return toFailure(error);
  }
}

/** 勾选 / 取消勾选子任务（不影响主任务状态）。 */
export async function togglePersonalSubtaskAction(
  taskId: string,
  subtaskId: string,
  completed: boolean,
): Promise<ActionResult<Subtask>> {
  const user = await requireUser();

  try {
    const subtask = await togglePersonalSubtask(
      user.id,
      taskId,
      subtaskId,
      completed,
    );
    return { ok: true, data: subtask };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除子任务。 */
export async function removePersonalSubtaskAction(
  taskId: string,
  subtaskId: string,
): Promise<ActionResult<true>> {
  const user = await requireUser();

  try {
    await removePersonalSubtask(user.id, taskId, subtaskId);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}

/** 发表评论（个人任务下即自我备注）。 */
export async function addPersonalCommentAction(
  taskId: string,
  content: string,
): Promise<ActionResult<Comment>> {
  const user = await requireUser();

  try {
    const comment = await addPersonalComment(user.id, taskId, content);
    return { ok: true, data: comment };
  } catch (error) {
    return toFailure(error);
  }
}

/** 删除评论（仅作者）。 */
export async function deletePersonalCommentAction(
  taskId: string,
  commentId: string,
): Promise<ActionResult<true>> {
  const user = await requireUser();

  try {
    await deletePersonalComment(user.id, taskId, commentId);
    return { ok: true, data: true };
  } catch (error) {
    return toFailure(error);
  }
}
