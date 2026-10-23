import type {
  Comment,
  Subtask,
  Task,
  TaskStatus,
} from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { TaskDetailModel } from "@/components/ui/task-detail/types";
import { DomainError } from "@/lib/domain-error";
import { db, type DbClient } from "@/server/db/client";
import {
  comments,
  projects,
  subtasks,
  tasks,
  users,
} from "@/server/db/schema";

/** 任务标题长度上限（与表单校验一致）。 */
export const TASK_TITLE_MAX_LENGTH = 200;

/** 子任务标题长度上限（与任务标题保持一致）。 */
export const SUBTASK_TITLE_MAX_LENGTH = 200;

/** 评论内容长度上限（与表单校验一致）。 */
export const COMMENT_MAX_LENGTH = 2000;

/** 创建任务入参；`projectId` 为空表示不属于任何项目的零散个人任务。 */
export interface PersonalTaskInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  projectId?: string | null;
}

type TaskRow = typeof tasks.$inferSelect;
type SubtaskRow = typeof subtasks.$inferSelect;
type CommentRow = typeof comments.$inferSelect;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 任务状态全集（用于运行时校验）。 */
const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/**
 * 路由参数可能不是 UUID（例如手工拼出的地址）。
 *
 * 数据库在收到非法 UUID 时会直接报错，这里提前拦截并统一按「不存在」处理。
 */
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** 数据库行 -> 可跨边界传递的领域 Task（时间统一为 ISO 字符串）。 */
function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    spaceType: row.spaceType,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 标题去空白后校验 1–200 字；`label` 决定错误文案（任务 / 子任务）。 */
function validateTitle(value: unknown, label: "任务" | "子任务"): string {
  const max =
    label === "任务" ? TASK_TITLE_MAX_LENGTH : SUBTASK_TITLE_MAX_LENGTH;
  const title = typeof value === "string" ? value.trim() : "";

  if (!title) {
    throw new DomainError(`请输入${label}标题`, "title");
  }
  if (title.length > max) {
    throw new DomainError(`${label}标题不能超过 ${max} 个字符`, "title");
  }

  return title;
}

/** 描述清空统一存 null，读取时映射为 undefined。 */
function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 截止日期只接受 `YYYY-MM-DD`（可在日历中真实存在）或空值。
 *
 * 空字符串 / null / undefined 统一存 null。
 */
function validateDueDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DomainError("截止日期格式应为 YYYY-MM-DD", "dueDate");
  }

  const dueDate = value.trim();
  if (!dueDate) return null;
  if (!DUE_DATE_PATTERN.test(dueDate)) {
    throw new DomainError("截止日期格式应为 YYYY-MM-DD", "dueDate");
  }

  const [year, month, day] = dueDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  const isRealDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day;

  if (!isRealDate) {
    throw new DomainError("截止日期不是有效日期", "dueDate");
  }

  return dueDate;
}

/** 状态只允许三态，防止外部传入任意字符串。 */
function validateStatus(value: unknown): TaskStatus {
  if (TASK_STATUSES.includes(value as TaskStatus)) {
    return value as TaskStatus;
  }

  throw new DomainError("任务状态不合法", "status");
}

/** 评论内容去空白后校验 1–2000 字。 */
function validateCommentContent(value: unknown): string {
  const content = typeof value === "string" ? value.trim() : "";

  if (!content) {
    throw new DomainError("请输入评论内容", "content");
  }
  if (content.length > COMMENT_MAX_LENGTH) {
    throw new DomainError(
      `评论不能超过 ${COMMENT_MAX_LENGTH} 个字符`,
      "content",
    );
  }

  return content;
}

/** projectId 空字符串按「不属于项目」处理。 */
function normalizeProjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 读取本人个人任务行（内部使用）；不存在 / 非本人 / 非 UUID 返回 undefined。 */
async function findOwnedPersonalTaskRow(
  userId: string,
  taskId: string,
  client: DbClient,
): Promise<TaskRow | undefined> {
  if (!isUuid(taskId)) return undefined;

  const [row] = await client
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.spaceType, "personal"),
        eq(tasks.assigneeId, userId),
      ),
    )
    .limit(1);

  return row;
}

/** 归属断言失败统一抛 DomainError；子任务 / 评论操作都先过这一关。 */
async function requireOwnedPersonalTaskRow(
  userId: string,
  taskId: string,
  client: DbClient,
): Promise<TaskRow> {
  const row = await findOwnedPersonalTaskRow(userId, taskId, client);
  if (!row) {
    throw new DomainError("任务不存在或无权访问");
  }

  return row;
}

/** 个人项目是否属于该用户（非 UUID / 不存在均返回 false）。 */
async function isOwnedPersonalProject(
  userId: string,
  projectId: string,
  client: DbClient,
): Promise<boolean> {
  if (!isUuid(projectId)) return false;

  const [row] = await client
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .limit(1);

  return Boolean(row);
}

/**
 * 创建个人任务。
 *
 * - `spaceType='personal'`、`assigneeId=userId`、`status='todo'`；
 * - `projectId` 非空时断言项目归本人所有；
 * - 标题必填 1–200 字；截止日期为 `YYYY-MM-DD` 或空。
 */
export async function createPersonalTask(
  userId: string,
  input: PersonalTaskInput,
  client: DbClient = db,
): Promise<Task> {
  const title = validateTitle(input?.title, "任务");
  const description = normalizeDescription(input?.description);
  const dueDate = validateDueDate(input?.dueDate);
  const projectId = normalizeProjectId(input?.projectId);

  if (projectId && !(await isOwnedPersonalProject(userId, projectId, client))) {
    throw new DomainError("项目不存在或无权访问", "projectId");
  }

  const [row] = await client
    .insert(tasks)
    .values({
      projectId,
      spaceType: "personal",
      title,
      description,
      status: "todo",
      assigneeId: userId,
      dueDate,
      createdById: userId,
    })
    .returning();

  if (!row) {
    throw new DomainError("任务创建失败，请稍后重试");
  }

  return toTask(row);
}

/**
 * 列出某个个人项目下的任务，按创建时间升序，并附带各自子任务。
 *
 * 非本人项目 / 非 UUID 一律返回空数组，语义与「详情返回 null」一致，
 * 不向调用方泄露项目是否存在。
 */
export async function listPersonalProjectTasks(
  userId: string,
  projectId: string,
  client: DbClient = db,
): Promise<(Task & { subtasks: Subtask[] })[]> {
  if (!(await isOwnedPersonalProject(userId, projectId, client))) {
    return [];
  }

  const taskRows = await client
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.spaceType, "personal"),
        eq(tasks.assigneeId, userId),
      ),
    )
    .orderBy(asc(tasks.createdAt));

  const taskIds = taskRows.map((row) => row.id);
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

  return taskRows.map((row) => ({
    ...toTask(row),
    subtasks: subtasksByTaskId.get(row.id) ?? [],
  }));
}

/**
 * 读取个人任务详情（归属断言：`space_type='personal' AND assignee_id=userId`）。
 *
 * 非本人 / 不存在 / 非 UUID 均返回 null；详情中组装项目名、责任人名、
 * 子任务、评论作者名，并按 `getTaskProgress` 计算进度。
 */
export async function getPersonalTaskDetail(
  userId: string,
  taskId: string,
  client: DbClient = db,
): Promise<TaskDetailModel | null> {
  if (!isUuid(taskId)) return null;

  const [row] = await client
    .select({
      task: tasks,
      projectName: projects.name,
      assigneeName: users.username,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.spaceType, "personal"),
        eq(tasks.assigneeId, userId),
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
    .select({ comment: comments, authorName: users.username })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt));

  const mappedSubtasks = subtaskRows.map(toSubtask);
  const task = row.task;

  return {
    id: task.id,
    projectId: task.projectId,
    spaceType: "personal",
    title: task.title,
    description: task.description ?? undefined,
    status: task.status,
    assigneeId: task.assigneeId,
    assigneeName: row.assigneeName ?? null,
    dueDate: task.dueDate ?? undefined,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    projectName: row.projectName ?? null,
    progress: getTaskProgress({
      status: task.status,
      subtasks: mappedSubtasks,
    }),
    subtasks: mappedSubtasks,
    comments: commentRows.map(({ comment, authorName }) => ({
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      authorName,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
    })),
  };
}

/**
 * 更新个人任务。
 *
 * 状态只能经此手动流转；未传字段保持不变，更新时刷新 `updatedAt`。
 * 传空描述会清空描述，`dueDate: null` 会清空截止日期。
 */
export async function updatePersonalTask(
  userId: string,
  taskId: string,
  input: {
    title?: string;
    description?: string;
    dueDate?: string | null;
    status?: TaskStatus;
  },
  client: DbClient = db,
): Promise<Task> {
  const existing = await requireOwnedPersonalTaskRow(userId, taskId, client);

  const changes: Partial<
    Pick<TaskRow, "title" | "description" | "dueDate" | "status" | "updatedAt">
  > = {};

  if (input?.title !== undefined) {
    changes.title = validateTitle(input.title, "任务");
  }
  if (input?.description !== undefined) {
    changes.description = normalizeDescription(input.description);
  }
  if (input?.dueDate !== undefined) {
    changes.dueDate = validateDueDate(input.dueDate);
  }
  if (input?.status !== undefined) {
    changes.status = validateStatus(input.status);
  }

  if (Object.keys(changes).length === 0) {
    return toTask(existing);
  }

  changes.updatedAt = new Date();

  const [row] = await client
    .update(tasks)
    .set(changes)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.spaceType, "personal"),
        eq(tasks.assigneeId, userId),
      ),
    )
    .returning();

  if (!row) {
    throw new DomainError("任务不存在或无权访问");
  }

  return toTask(row);
}

/**
 * 删除个人任务。
 *
 * 归属断言失败抛 DomainError；子任务 / 评论由数据库外键级联删除。
 */
export async function deletePersonalTask(
  userId: string,
  taskId: string,
  client: DbClient = db,
): Promise<void> {
  if (!isUuid(taskId)) {
    throw new DomainError("任务不存在或无权访问");
  }

  const [row] = await client
    .delete(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.spaceType, "personal"),
        eq(tasks.assigneeId, userId),
      ),
    )
    .returning({ id: tasks.id });

  if (!row) {
    throw new DomainError("任务不存在或无权访问");
  }
}

/** 新增子任务（先断言主任务归属）。 */
export async function addPersonalSubtask(
  userId: string,
  taskId: string,
  title: string,
  client: DbClient = db,
): Promise<Subtask> {
  await requireOwnedPersonalTaskRow(userId, taskId, client);
  const validatedTitle = validateTitle(title, "子任务");

  const [row] = await client
    .insert(subtasks)
    .values({ taskId, title: validatedTitle })
    .returning();

  if (!row) {
    throw new DomainError("子任务创建失败，请稍后重试");
  }

  return toSubtask(row);
}

/** 删除子任务（仅限本人任务下的子任务）。 */
export async function removePersonalSubtask(
  userId: string,
  taskId: string,
  subtaskId: string,
  client: DbClient = db,
): Promise<void> {
  await requireOwnedPersonalTaskRow(userId, taskId, client);

  if (!isUuid(subtaskId)) {
    throw new DomainError("子任务不存在或无权访问");
  }

  const [row] = await client
    .delete(subtasks)
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
    .returning({ id: subtasks.id });

  if (!row) {
    throw new DomainError("子任务不存在或无权访问");
  }
}

/**
 * 勾选 / 取消勾选子任务。
 *
 * 只改 `completed` 与 `completedAt`，**绝不改主任务 status 或 updatedAt**；
 * 任务状态只能通过 `updatePersonalTask` 手动流转。
 */
export async function togglePersonalSubtask(
  userId: string,
  taskId: string,
  subtaskId: string,
  completed: boolean,
  client: DbClient = db,
): Promise<Subtask> {
  await requireOwnedPersonalTaskRow(userId, taskId, client);

  if (!isUuid(subtaskId)) {
    throw new DomainError("子任务不存在或无权访问");
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
    throw new DomainError("子任务不存在或无权访问");
  }

  return toSubtask(row);
}

/** 新增评论（个人任务下即自我备注），内容 1–2000 字。 */
export async function addPersonalComment(
  userId: string,
  taskId: string,
  content: string,
  client: DbClient = db,
): Promise<Comment> {
  await requireOwnedPersonalTaskRow(userId, taskId, client);
  const validatedContent = validateCommentContent(content);

  const [row] = await client
    .insert(comments)
    .values({ taskId, authorId: userId, content: validatedContent })
    .returning();

  if (!row) {
    throw new DomainError("评论创建失败，请稍后重试");
  }

  return toComment(row);
}

/** 删除评论（仅作者；个人任务恒为本人）。 */
export async function deletePersonalComment(
  userId: string,
  taskId: string,
  commentId: string,
  client: DbClient = db,
): Promise<void> {
  await requireOwnedPersonalTaskRow(userId, taskId, client);

  if (!isUuid(commentId)) {
    throw new DomainError("评论不存在或无权删除");
  }

  const [row] = await client
    .delete(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.taskId, taskId),
        eq(comments.authorId, userId),
      ),
    )
    .returning({ id: comments.id });

  if (!row) {
    throw new DomainError("评论不存在或无权删除");
  }
}
