"use server";

import type {
  Comment,
  Subtask,
  Task,
  TaskPriority,
  TaskStatus,
} from "@open-doing/types";
import { z } from "zod";

import type { ActionResult } from "@/features/auth/actions";
import { getCurrentUser } from "@/features/auth/session";
import { TeamPermissionError } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";
import { isUuid } from "@/lib/task-fields";

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
 * 虚拟成员责任人入参：可空 UUID（客户端可能附任意值，action 先行校验）。
 *
 * 复用 `isUuid` 而非 `z.uuid()`：与 service 层的 UUID 判定保持同一口径
 * （8-4-4-4-12 十六进制，不限制 RFC 版本；种子 / 测试常用占位 UUID）。
 */
const assigneeVirtualIdSchema = z
  .string()
  .refine(isUuid)
  .nullable()
  .optional();

/**
 * 解析并校验 `assigneeVirtualId`。
 *
 * 非法值走与 service 相同的字段错误（`assigneeId` + `assigneeNotVirtualMember`），
 * 不触达 service，避免客户端把畸形值带进查询层。
 */
function parseAssigneeVirtualId(value: unknown): string | null | undefined {
  const parsed = assigneeVirtualIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("只能指派给该团队的虚拟成员", "assigneeId", {
      key: "assigneeNotVirtualMember",
    });
  }
  return parsed.data;
}

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
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  assigneeId?: string | null;
  /** 虚拟成员责任人；与 `assigneeId` 互斥（service 层裁决）。 */
  assigneeVirtualId?: string | null;
}): Promise<ActionResult<Task>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    // 只转发白名单字段：客户端可附任意多余键，不能直接 spread 进入 service。
    const {
      teamId,
      projectId,
      title,
      description,
      priority,
      dueDate,
      startDate,
      assigneeId,
    } = input;
    const assigneeVirtualId = parseAssigneeVirtualId(input.assigneeVirtualId);

    const task = await createTeamTask({
      teamId,
      projectId,
      title,
      actorId: user.id,
      ...(description !== undefined ? { description } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
      ...(assigneeVirtualId !== undefined ? { assigneeVirtualId } : {}),
    });
    return { ok: true, data: task };
  } catch (error) {
    return toFailure(error);
  }
}

/** 更新团队任务（标题 / 描述 / 优先级 / 截止日期 / 开始时间 / 状态 / 责任人）。 */
export async function updateTeamTaskAction(
  taskId: string,
  input: {
    teamId: string;
    title?: string;
    description?: string;
    priority?: TaskPriority;
    dueDate?: string | null;
    startDate?: string | null;
    status?: TaskStatus;
    assigneeId?: string;
    /** 虚拟成员责任人；与 `assigneeId` 互斥（service 层裁决）。 */
    assigneeVirtualId?: string | null;
  },
): Promise<ActionResult<Task>> {
  const user = await getCurrentUser();
  if (!user) return (await standardFailuresForRequest()).notLoggedIn();

  try {
    // 只转发白名单字段：客户端可附任意多余键，不能直接 spread 进入 service。
    const {
      teamId,
      title,
      description,
      priority,
      dueDate,
      startDate,
      status,
      assigneeId,
    } = input;
    const assigneeVirtualId = parseAssigneeVirtualId(input.assigneeVirtualId);

    const task = await updateTeamTask({
      taskId,
      teamId,
      actorId: user.id,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
      ...(assigneeVirtualId !== undefined ? { assigneeVirtualId } : {}),
    });
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

  // 只转发白名单字段：`authorVirtualId` 是 MCP-only 的 service 入参，
  // 不能经 Server Action 由客户端附加（否则可伪造 agent 署名）。
  const { teamId, taskId, content } = input;

  try {
    const comment = await addTeamComment({
      teamId,
      taskId,
      content,
      actorId: user.id,
    });
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
