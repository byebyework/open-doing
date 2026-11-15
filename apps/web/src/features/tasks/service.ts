import type {
  AssigneeRef,
  Comment,
  Subtask,
  Task,
  TaskPriority,
  TaskStatus,
} from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { TaskDetailModel } from "@/components/ui/task-detail/types";
import {
  createNotification,
  type CreateNotificationInput,
} from "@/features/notifications/service";
import { getMembership, type TeamRole } from "@/features/teams/permissions";
import { DomainError } from "@/lib/domain-error";
import {
  assertStartNotAfterTaskDue,
  isUuid,
  validateCommentContent,
  validateTaskDescription,
  validateTaskDueDate,
  validateTaskPriority,
  validateTaskStartDate,
  validateTaskStatus,
  validateTaskTitle,
} from "@/lib/task-fields";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  comments,
  projects,
  subtasks,
  tasks,
  teams,
  users,
  virtualMembers,
} from "@/server/db/schema";

import {
  assertCanAssignTask,
  assertCanDeleteTask,
  assertCanEditTask,
  canComment,
} from "./permissions";

/**
 * 团队任务 service（J-2）。
 *
 * 所有鉴权都在本层完成：调用方只传 `actorId`，不信任任何前端角色位。
 * - 团队可见性：任务必须 `space_type='team'` 且通过 `projects.team_id`
 *   归属到目标团队；个人任务、跨团队任务一律按「不存在」处理。
 * - 任务级权限：见 `./permissions`（owner/admin 任意，member 仅本人任务）。
 */

type TaskRow = typeof tasks.$inferSelect;
type SubtaskRow = typeof subtasks.$inferSelect;
type CommentRow = typeof comments.$inferSelect;

/** 列表行：任务 + 子任务 + 责任人展示名与身份引用（责任人已退出时为 null）。 */
export interface TeamTaskRow extends Task {
  subtasks: Subtask[];
  assigneeName: string | null;
  /** 责任人身份引用：真人用户或虚拟成员；未指派时为 null。 */
  assigneeRef: AssigneeRef | null;
}

/** 数据库行 -> 可跨边界传递的领域 Task。 */
function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    spaceType: row.spaceType,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    assigneeVirtualId: row.assigneeVirtualId,
    dueDate: row.dueDate ?? undefined,
    startDate: row.startDate ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 责任人 join 字段（真人列 + 虚拟成员列，互斥可空）。 */
interface AssigneeJoinFields {
  username: string | null;
  nickname: string | null;
  image: string | null;
  virtualName: string | null;
  virtualAccentColor: string | null;
}

/**
 * 由任务行 + 责任人 join 字段组装展示名与身份引用。
 *
 * 展示名 coalesce 顺序：昵称 → 用户名 → 虚拟成员名；未指派（或被移除）为 null。
 */
function buildAssignee(
  task: TaskRow,
  fields: AssigneeJoinFields,
): { assigneeName: string | null; assigneeRef: AssigneeRef | null } {
  const assigneeName =
    fields.nickname ?? fields.username ?? fields.virtualName ?? null;

  if (task.assigneeVirtualId !== null && fields.virtualName !== null) {
    return {
      assigneeName,
      assigneeRef: {
        type: "virtual",
        virtualMemberId: task.assigneeVirtualId,
        name: fields.virtualName,
        accentColor: fields.virtualAccentColor,
      },
    };
  }

  if (task.assigneeId !== null && fields.username !== null) {
    return {
      assigneeName,
      assigneeRef: {
        type: "user",
        userId: task.assigneeId,
        name: fields.nickname ?? fields.username,
        image: fields.image,
      },
    };
  }

  return { assigneeName, assigneeRef: null };
}

/** 数据库行 -> 可序列化 Subtask。 */
function toSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    completed: row.completed,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? undefined,
  };
}

/** 数据库行 -> 可序列化 Comment。 */
function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.taskId,
    // 过渡期断言：Phase 1 评论恒为真人作者；虚拟作者列放宽后由后续任务接续。
    authorId: row.authorId as string,
    authorVirtualId: row.authorVirtualId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 断言调用者是团队成员并返回角色。
 *
 * 非成员（含团队不存在）统一抛同一条文案，不泄露团队存在性。
 */
async function requireMember(
  teamId: string,
  actorId: string,
  client: DbClient,
): Promise<TeamRole> {
  if (!isUuid(teamId) || !isUuid(actorId)) {
    throw new DomainError("团队不存在或无权访问", undefined, { key: "teamNotFound" });
  }

  const membership = await getMembership(teamId, actorId, client);
  if (!membership) {
    throw new DomainError("团队不存在或无权访问", undefined, { key: "teamNotFound" });
  }

  return membership.role;
}

/** 读取任务行并断言它属于该团队（个人任务 / 跨团队返回 undefined）。 */
async function findTeamTaskRow(
  teamId: string,
  taskId: string,
  client: DbClient,
): Promise<{ task: TaskRow; projectId: string } | undefined> {
  if (!isUuid(teamId) || !isUuid(taskId)) return undefined;

  const [row] = await client
    .select({ task: tasks, projectId: projects.id })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.spaceType, "team"),
        eq(projects.teamId, teamId),
      ),
    )
    .limit(1);

  return row;
}

/** 写操作入口：先断言成员身份，再断言任务归属。 */
async function requireTeamTask(
  teamId: string,
  taskId: string,
  actorId: string,
  client: DbClient,
): Promise<{ task: TaskRow; projectId: string; role: TeamRole }> {
  const role = await requireMember(teamId, actorId, client);
  const found = await findTeamTaskRow(teamId, taskId, client);

  if (!found) {
    throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
  }

  return { task: found.task, projectId: found.projectId, role };
}

/** 指派目标必须是该团队成员；非法 UUID 同样按「非成员」拒绝。 */
async function requireAssignableMember(
  teamId: string,
  userId: string,
  client: DbClient,
): Promise<void> {
  if (!isUuid(userId)) {
    throw new DomainError("只能指派给团队内成员", "assigneeId", { key: "assigneeNotMember" });
  }

  const membership = await getMembership(teamId, userId, client);
  if (!membership) {
    throw new DomainError("只能指派给团队内成员", "assigneeId", { key: "assigneeNotMember" });
  }
}

/**
 * 指派目标必须是该团队的虚拟成员，且该团队本身是虚拟团队。
 *
 * 真实团队、非法 UUID、不存在的虚拟成员、跨团队虚拟成员统一按
 * 「非该团队虚拟成员」拒绝，不泄露团队 / 成员存在性。
 */
async function requireAssignableVirtualMember(
  teamId: string,
  virtualMemberId: string,
  client: DbClient,
): Promise<void> {
  const notVirtualMember = () =>
    new DomainError("只能指派给该团队的虚拟成员", "assigneeId", {
      key: "assigneeNotVirtualMember",
    });

  if (!isUuid(virtualMemberId)) throw notVirtualMember();

  // 团队类型校验独立于成员关系：真实团队不允许任何虚拟指派。
  const [team] = await client
    .select({ kind: teams.kind })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team || team.kind !== "virtual") throw notVirtualMember();

  const [row] = await client
    .select({ id: virtualMembers.id })
    .from(virtualMembers)
    .where(
      and(
        eq(virtualMembers.id, virtualMemberId),
        eq(virtualMembers.teamId, teamId),
      ),
    )
    .limit(1);
  if (!row) throw notVirtualMember();
}

/**
 * 发通知并吞掉唯一索引撞车（23505）。
 *
 * 通知表 `(user_id, task_id, type)` 部分唯一索引保证同一任务同类通知只留
 * 一条；重复触发（例如多人先后评论）不应让业务写入失败。嵌套事务即
 * savepoint：撞车只回滚这条 INSERT。N-1 接管去重后此包装可移除。
 */
async function notifySafely(
  client: DbClient,
  input: CreateNotificationInput,
): Promise<void> {
  try {
    await client.transaction(async (tx) => createNotification(input, tx));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

/** 项目必须属于该团队；非法 UUID 与不存在的项目同样拒绝。 */
async function requireTeamProject(
  teamId: string,
  projectId: string,
  client: DbClient,
): Promise<void> {
  if (!isUuid(projectId)) {
    throw new DomainError("项目不存在或无权访问", "projectId", { key: "projectNotFound" });
  }

  const [row] = await client
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);

  if (!row) {
    throw new DomainError("项目不存在或无权访问", "projectId", { key: "projectNotFound" });
  }
}

/**
 * 创建团队任务。
 *
 * - 任何成员可建；`assigneeId` 缺省为本人，显式指派必须是团队成员；
 * - 指派给他人时给责任人发 `task_assigned`（自己指派自己不通知）。
 */
export async function createTeamTask(
  input: {
    teamId: string;
    projectId: string;
    actorId: string;
    title: string;
    description?: string;
    /** 优先级三档；缺省由列默认值落为 medium。 */
    priority?: TaskPriority;
    dueDate?: string | null;
    startDate?: string | null;
    assigneeId?: string | null;
    /** 虚拟成员责任人；与 `assigneeId` 互斥（仅虚拟团队可用）。 */
    assigneeVirtualId?: string | null;
  },
  client: DbClient = db,
): Promise<Task> {
  const { teamId, projectId, actorId } = input;
  const title = validateTaskTitle(input?.title);
  const description = validateTaskDescription(input?.description);
  const priority = validateTaskPriority(input?.priority ?? "medium");
  const dueDate = validateTaskDueDate(input?.dueDate);
  const startDate = validateTaskStartDate(input?.startDate);
  assertStartNotAfterTaskDue(startDate, dueDate);

  const virtualAssigneeId = input.assigneeVirtualId ?? null;
  if (virtualAssigneeId !== null && input.assigneeId != null) {
    throw new DomainError(
      "不能同时指派给真人与虚拟成员",
      "assigneeId",
      { key: "assigneeConflict" },
    );
  }
  // 真人指派：缺省为本人；指派虚拟成员时真人列恒为 null（DB CHECK 兜底）。
  const realAssigneeId = input.assigneeId ?? actorId;
  const assigneeId = virtualAssigneeId !== null ? null : realAssigneeId;

  return client.transaction(async (tx) => {
    await requireMember(teamId, actorId, tx);
    await requireTeamProject(teamId, projectId, tx);
    if (virtualAssigneeId !== null) {
      await requireAssignableVirtualMember(teamId, virtualAssigneeId, tx);
    } else {
      await requireAssignableMember(teamId, realAssigneeId, tx);
    }

    const [row] = await tx
      .insert(tasks)
      .values({
        projectId,
        spaceType: "team",
        title,
        description,
        status: "todo",
        priority,
        assigneeId,
        assigneeVirtualId: virtualAssigneeId,
        dueDate,
        startDate,
        createdById: actorId,
      })
      .returning();

    if (!row) {
      throw new DomainError("任务创建失败，请稍后重试", undefined, { key: "taskCreateFailed" });
    }

    // 虚拟成员无法接收通知；仅真人责任人且不是操作者本人时发。
    if (assigneeId !== null && assigneeId !== actorId) {
      await notifySafely(tx, {
        userId: assigneeId,
        type: "task_assigned",
        teamId,
        projectId,
        taskId: row.id,
        actorId,
      });
    }

    return toTask(row);
  });
}

/** 更新任务入参：未传字段保持不变，`dueDate: null` 清空截止日期。 */
export interface UpdateTeamTaskInput {
  teamId: string;
  taskId: string;
  actorId: string;
  title?: string;
  description?: string;
  /** 优先级三档；作为内容字段纳入 `task:edit` 权限判定。 */
  priority?: TaskPriority;
  dueDate?: string | null;
  /** 开始日期；`null` 清空。作为内容字段纳入 `task:edit` 权限判定。 */
  startDate?: string | null;
  status?: TaskStatus;
  assigneeId?: string;
  /** 虚拟成员责任人：非空时改派到该成员并清空真人责任人；`null` 清空虚拟指派。 */
  assigneeVirtualId?: string | null;
}

/**
 * 更新团队任务。
 *
 * 内容字段要求 `task:edit`，改派要求 `task:assign`（见 `./permissions`）。
 * 通知：改派 → 新责任人 `task_assigned`；owner/admin 改动他人任务 →
 * 原责任人 `task_changed_by_admin`。
 */
export async function updateTeamTask(
  input: UpdateTeamTaskInput,
  client: DbClient = db,
): Promise<Task> {
  const { teamId, taskId, actorId } = input;
  const existing = await requireTeamTask(teamId, taskId, actorId, client);
  const currentAssigneeId = existing.task.assigneeId;
  const currentAssigneeVirtualId = existing.task.assigneeVirtualId;

  const changes: Partial<
    Pick<
      TaskRow,
      | "title"
      | "description"
      | "priority"
      | "dueDate"
      | "startDate"
      | "status"
      | "assigneeId"
      | "assigneeVirtualId"
      | "updatedAt"
    >
  > = {};
  // 出现内容字段即要求 `task:edit`（防止用原值探测权限）；
  // 只有值真的变了才写库、推进 `updatedAt` 或通知原责任人。
  let hasContentChange = false;
  let hasValueChange = false;

  if (input.title !== undefined) {
    hasContentChange = true;
    const title = validateTaskTitle(input.title);
    if (title !== existing.task.title) {
      changes.title = title;
      hasValueChange = true;
    }
  }
  if (input.description !== undefined) {
    hasContentChange = true;
    const description = validateTaskDescription(input.description);
    if ((description ?? null) !== (existing.task.description ?? null)) {
      changes.description = description;
      hasValueChange = true;
    }
  }
  if (input.dueDate !== undefined) {
    hasContentChange = true;
    const dueDate = validateTaskDueDate(input.dueDate);
    if ((dueDate ?? null) !== (existing.task.dueDate ?? null)) {
      changes.dueDate = dueDate;
      hasValueChange = true;
    }
  }
  if (input.startDate !== undefined) {
    hasContentChange = true;
    const startDate = validateTaskStartDate(input.startDate);
    if ((startDate ?? null) !== (existing.task.startDate ?? null)) {
      changes.startDate = startDate;
      hasValueChange = true;
    }
  }
  if (input.status !== undefined) {
    hasContentChange = true;
    const status = validateTaskStatus(input.status);
    if (status !== existing.task.status) {
      changes.status = status;
      hasValueChange = true;
    }
  }
  if (input.priority !== undefined) {
    hasContentChange = true;
    const priority = validateTaskPriority(input.priority);
    if (priority !== existing.task.priority) {
      changes.priority = priority;
      hasValueChange = true;
    }
  }

  // 与新值组合出最终日期对，校验开始不晚于截止。
  assertStartNotAfterTaskDue(
    (changes.startDate ?? existing.task.startDate ?? null) as string | null,
    (changes.dueDate ?? existing.task.dueDate ?? null) as string | null,
  );

  if (hasContentChange) {
    assertCanEditTask({
      role: existing.role,
      actorId,
      assigneeId: currentAssigneeId,
    });
  }

  // 真人 / 虚拟成员同时显式指派视为冲突（DB CHECK 兜底，service 先行拦截）。
  if (
    input.assigneeId !== undefined &&
    input.assigneeVirtualId !== undefined &&
    input.assigneeVirtualId !== null
  ) {
    throw new DomainError(
      "不能同时指派给真人与虚拟成员",
      "assigneeId",
      { key: "assigneeConflict" },
    );
  }

  // 改派目标：互斥写入，换指派类型时清空另一列。
  let assigneeChange:
    | { assigneeId: string | null; assigneeVirtualId: string | null }
    | undefined;

  if (input.assigneeId !== undefined) {
    if (
      input.assigneeId !== currentAssigneeId ||
      currentAssigneeVirtualId !== null
    ) {
      assertCanAssignTask({
        role: existing.role,
        actorId,
        assigneeId: currentAssigneeId,
      });
      await requireAssignableMember(teamId, input.assigneeId, client);
      assigneeChange = {
        assigneeId: input.assigneeId,
        assigneeVirtualId: null,
      };
    }
  } else if (input.assigneeVirtualId !== undefined) {
    if (input.assigneeVirtualId !== null) {
      if (
        input.assigneeVirtualId !== currentAssigneeVirtualId ||
        currentAssigneeId !== null
      ) {
        assertCanAssignTask({
          role: existing.role,
          actorId,
          assigneeId: currentAssigneeId,
        });
        await requireAssignableVirtualMember(
          teamId,
          input.assigneeVirtualId,
          client,
        );
        assigneeChange = {
          assigneeId: null,
          assigneeVirtualId: input.assigneeVirtualId,
        };
      }
    } else if (currentAssigneeVirtualId !== null) {
      // 显式清空虚拟指派：真人责任人保持不变（无真人时即回到未指派）。
      assertCanAssignTask({
        role: existing.role,
        actorId,
        assigneeId: currentAssigneeId,
      });
      assigneeChange = { assigneeId: null, assigneeVirtualId: null };
    }
  }

  if (Object.keys(changes).length === 0 && assigneeChange === undefined) {
    return toTask(existing.task);
  }

  changes.updatedAt = new Date();
  if (assigneeChange !== undefined) {
    changes.assigneeId = assigneeChange.assigneeId;
    changes.assigneeVirtualId = assigneeChange.assigneeVirtualId;
  }

  return client.transaction(async (tx) => {
    const [row] = await tx
      .update(tasks)
      .set(changes)
      .where(and(eq(tasks.id, taskId), eq(tasks.spaceType, "team")))
      .returning();

    if (!row) {
      throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
    }

    // 虚拟成员无法接收通知；仅真人新责任人且不是操作者本人时发。
    if (
      assigneeChange?.assigneeId != null &&
      assigneeChange.assigneeId !== actorId
    ) {
      await notifySafely(tx, {
        userId: assigneeChange.assigneeId,
        type: "task_assigned",
        teamId,
        projectId: existing.projectId,
        taskId,
        actorId,
      });
    }

    const isAdminEdit = existing.role === "owner" || existing.role === "admin";
    if (
      hasValueChange &&
      isAdminEdit &&
      currentAssigneeId !== null &&
      currentAssigneeId !== actorId
    ) {
      await notifySafely(tx, {
        userId: currentAssigneeId,
        type: "task_changed_by_admin",
        teamId,
        projectId: existing.projectId,
        taskId,
        actorId,
      });
    }

    return toTask(row);
  });
}

/** 删除任务（子任务 / 评论由数据库级联删除）。 */
export async function deleteTeamTask(
  input: { teamId: string; taskId: string; actorId: string },
  client: DbClient = db,
): Promise<void> {
  const { teamId, taskId, actorId } = input;
  const existing = await requireTeamTask(teamId, taskId, actorId, client);

  assertCanDeleteTask({
    role: existing.role,
    actorId,
    assigneeId: existing.task.assigneeId,
  });

  const [row] = await client
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.spaceType, "team")))
    .returning({ id: tasks.id });

  if (!row) {
    throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
  }
}

/** 新增子任务（需 `task:edit`）。 */
export async function addTeamSubtask(
  input: { teamId: string; taskId: string; actorId: string; title: string },
  client: DbClient = db,
): Promise<Subtask> {
  const { teamId, taskId, actorId } = input;
  const existing = await requireTeamTask(teamId, taskId, actorId, client);

  assertCanEditTask({
    role: existing.role,
    actorId,
    assigneeId: existing.task.assigneeId,
  });

  const title = validateTaskTitle(input?.title, "子任务");

  const [row] = await client
    .insert(subtasks)
    .values({ taskId, title })
    .returning();

  if (!row) {
    throw new DomainError("子任务创建失败，请稍后重试", undefined, { key: "subtaskCreateFailed" });
  }

  return toSubtask(row);
}

/** 删除子任务（需 `task:edit`）。 */
export async function removeTeamSubtask(
  input: {
    teamId: string;
    taskId: string;
    actorId: string;
    subtaskId: string;
  },
  client: DbClient = db,
): Promise<void> {
  const { teamId, taskId, actorId, subtaskId } = input;
  const existing = await requireTeamTask(teamId, taskId, actorId, client);

  assertCanEditTask({
    role: existing.role,
    actorId,
    assigneeId: existing.task.assigneeId,
  });

  if (!isUuid(subtaskId)) {
    throw new DomainError("子任务不存在或无权访问", undefined, { key: "subtaskNotFound" });
  }

  const [row] = await client
    .delete(subtasks)
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
    .returning({ id: subtasks.id });

  if (!row) {
    throw new DomainError("子任务不存在或无权访问", undefined, { key: "subtaskNotFound" });
  }
}

/**
 * 勾选 / 取消勾选子任务（需 `task:edit`）。
 *
 * 只改 `completed` 与 `completedAt`，不改主任务状态与 `updatedAt`。
 */
export async function toggleTeamSubtask(
  input: {
    teamId: string;
    taskId: string;
    actorId: string;
    subtaskId: string;
    completed: boolean;
  },
  client: DbClient = db,
): Promise<Subtask> {
  const { teamId, taskId, actorId, subtaskId, completed } = input;
  const existing = await requireTeamTask(teamId, taskId, actorId, client);

  assertCanEditTask({
    role: existing.role,
    actorId,
    assigneeId: existing.task.assigneeId,
  });

  if (!isUuid(subtaskId)) {
    throw new DomainError("子任务不存在或无权访问", undefined, { key: "subtaskNotFound" });
  }

  const [row] = await client
    .update(subtasks)
    .set({
      completed,
      completedAt: completed ? new Date() : null,
    })
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
    .returning();

  if (!row) {
    throw new DomainError("子任务不存在或无权访问", undefined, { key: "subtaskNotFound" });
  }

  return toSubtask(row);
}

/** 新增评论：任何成员可发；通知当前责任人（评论自己不发）。 */
export async function addTeamComment(
  input: { teamId: string; taskId: string; actorId: string; content: string },
  client: DbClient = db,
): Promise<Comment> {
  const { teamId, taskId, actorId } = input;
  const existing = await requireTeamTask(teamId, taskId, actorId, client);

  if (!canComment(existing.role)) {
    throw new DomainError("团队不存在或无权访问", undefined, { key: "teamNotFound" });
  }

  const content = validateCommentContent(input?.content);
  const assigneeId = existing.task.assigneeId;

  return client.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({ taskId, authorId: actorId, content })
      .returning();

    if (!row) {
      throw new DomainError("评论创建失败，请稍后重试", undefined, { key: "commentCreateFailed" });
    }

    if (assigneeId !== null && assigneeId !== actorId) {
      await notifySafely(tx, {
        userId: assigneeId,
        type: "task_commented",
        teamId,
        projectId: existing.projectId,
        taskId,
        actorId,
      });
    }

    return toComment(row);
  });
}

/** 删除评论：仅作者本人（owner/admin 也不行）。 */
export async function deleteTeamComment(
  input: {
    teamId: string;
    taskId: string;
    actorId: string;
    commentId: string;
  },
  client: DbClient = db,
): Promise<void> {
  const { teamId, taskId, actorId, commentId } = input;
  await requireTeamTask(teamId, taskId, actorId, client);

  if (!isUuid(commentId)) {
    throw new DomainError("评论不存在或无权删除", undefined, { key: "commentNotFound" });
  }

  const [row] = await client
    .delete(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.taskId, taskId),
        eq(comments.authorId, actorId),
      ),
    )
    .returning({ id: comments.id });

  if (!row) {
    throw new DomainError("评论不存在或无权删除", undefined, { key: "commentNotFound" });
  }
}

/**
 * 列出团队项目下的任务（按创建时间升序，附子任务与责任人名）。
 *
 * 非成员 / 项目不属于该团队一律返回空数组，不泄露存在性。
 */
export async function listTeamProjectTasks(
  input: { teamId: string; projectId: string; actorId: string },
  client: DbClient = db,
): Promise<TeamTaskRow[]> {
  const { teamId, projectId, actorId } = input;
  if (!isUuid(teamId) || !isUuid(projectId) || !isUuid(actorId)) return [];

  const membership = await getMembership(teamId, actorId, client);
  if (!membership) return [];

  const [project] = await client
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);
  if (!project) return [];

  const rows = await client
    .select({
      task: tasks,
      assigneeUsername: users.username,
      assigneeNickname: users.name,
      assigneeImage: users.image,
      assigneeVirtualName: virtualMembers.name,
      assigneeVirtualAccentColor: virtualMembers.accentColor,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(virtualMembers, eq(tasks.assigneeVirtualId, virtualMembers.id))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.spaceType, "team")))
    .orderBy(asc(tasks.createdAt));

  const taskIds = rows.map((row) => row.task.id);
  const subtaskRows =
    taskIds.length > 0
      ? await client
          .select()
          .from(subtasks)
          .where(inArray(subtasks.taskId, taskIds))
          .orderBy(asc(subtasks.createdAt))
      : [];

  const subtasksByTaskId = new Map<string, Subtask[]>();
  for (const row of subtaskRows) {
    const list = subtasksByTaskId.get(row.taskId) ?? [];
    list.push(toSubtask(row));
    subtasksByTaskId.set(row.taskId, list);
  }

  return rows.map(
    ({
      task,
      assigneeUsername,
      assigneeNickname,
      assigneeImage,
      assigneeVirtualName,
      assigneeVirtualAccentColor,
    }) => {
      // 展示名：昵称 → 用户名 → 虚拟成员名；未指派（或被移除）为 null。
      const assignee = buildAssignee(task, {
        username: assigneeUsername,
        nickname: assigneeNickname,
        image: assigneeImage,
        virtualName: assigneeVirtualName,
        virtualAccentColor: assigneeVirtualAccentColor,
      });

      return {
        ...toTask(task),
        assigneeName: assignee.assigneeName,
        assigneeRef: assignee.assigneeRef,
        subtasks: subtasksByTaskId.get(task.id) ?? [],
      };
    },
  );
}

/**
 * 读取团队任务详情（含创建人 / 项目名 / 进度 / 评论作者名）。
 *
 * 非成员 / 个人任务 / 跨团队任务一律返回 null。
 */
export async function getTeamTaskDetail(
  input: { teamId: string; taskId: string; actorId: string },
  client: DbClient = db,
): Promise<TaskDetailModel | null> {
  const { teamId, taskId, actorId } = input;
  if (!isUuid(teamId) || !isUuid(taskId) || !isUuid(actorId)) return null;

  const membership = await getMembership(teamId, actorId, client);
  if (!membership) return null;

  const creators = alias(users, "creators");
  const [row] = await client
    .select({
      task: tasks,
      projectName: projects.name,
      assigneeUsername: users.username,
      assigneeNickname: users.name,
      assigneeImage: users.image,
      assigneeEmail: users.email,
      assigneeVirtualName: virtualMembers.name,
      assigneeVirtualAccentColor: virtualMembers.accentColor,
      creatorUsername: creators.username,
      creatorNickname: creators.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(virtualMembers, eq(tasks.assigneeVirtualId, virtualMembers.id))
    .leftJoin(creators, eq(tasks.createdById, creators.id))
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.spaceType, "team"),
        eq(projects.teamId, teamId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const subtaskRows = await client
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.createdAt));

  const commentRows = await client
    .select({
      comment: comments,
      authorUsername: users.username,
      authorNickname: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt));

  const mappedSubtasks = subtaskRows.map(toSubtask);
  const task = row.task;
  const assignee = buildAssignee(task, {
    username: row.assigneeUsername,
    nickname: row.assigneeNickname,
    image: row.assigneeImage,
    virtualName: row.assigneeVirtualName,
    virtualAccentColor: row.assigneeVirtualAccentColor,
  });

  return {
    id: task.id,
    projectId: task.projectId,
    spaceType: "team",
    title: task.title,
    description: task.description ?? undefined,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    // 展示名：昵称 → 用户名 → 虚拟成员名；未指派（或被移除）为 null。
    assigneeName: assignee.assigneeName,
    assigneeVirtualId: task.assigneeVirtualId,
    assigneeVirtualName: row.assigneeVirtualName ?? null,
    assigneeAccentColor: row.assigneeVirtualAccentColor ?? null,
    // 负责人信息处展示邮箱：仅真人责任人（选填资料，未填为 null 时不渲染）。
    assigneeEmail: task.assigneeId !== null ? (row.assigneeEmail ?? null) : null,
    dueDate: task.dueDate ?? undefined,
    startDate: task.startDate ?? undefined,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    projectName: row.projectName ?? null,
    creatorName: row.creatorNickname ?? row.creatorUsername ?? undefined,
    progress: getTaskProgress({
      status: task.status,
      subtasks: mappedSubtasks,
    }),
    subtasks: mappedSubtasks,
    comments: commentRows.map(
      ({ comment, authorUsername, authorNickname }) => ({
        id: comment.id,
        taskId: comment.taskId,
        // 过渡期断言：Phase 1 评论恒为真人作者（虚拟作者由后续任务接入）。
        authorId: comment.authorId as string,
        authorName: authorNickname ?? authorUsername,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
      }),
    ),
  };
}
