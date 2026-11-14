import type {
  Comment,
  Subtask,
  Task,
  TaskPriority,
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

// 任务字段限长常量的唯一来源是 lib/task-fields.ts（客户端安全，可被表单
// 组件直接导入）；本服务是 server-only 模块，常量从这里重导出仅为兼容
// 既有引用。校验器本体仍为本轨逐字副本（见文件头决策）。
import {
  COMMENT_MAX_LENGTH,
  SUBTASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "@/lib/task-fields";

export {
  COMMENT_MAX_LENGTH,
  SUBTASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "@/lib/task-fields";

/** 创建任务入参；`projectId` 为空表示不属于任何项目的零散个人任务。 */
export interface PersonalTaskInput {
  title: string;
  description?: string;
  /** 优先级三档；缺省由列默认值落为 medium。 */
  priority?: TaskPriority;
  dueDate?: string | null;
  /** 开始日期（`YYYY-MM-DD`，可空）；与 dueDate 同粒度，不得晚于截止日期。 */
  startDate?: string | null;
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

/** 任务优先级全集（用于运行时校验）。 */
const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high"];

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
    priority: row.priority,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate ?? undefined,
    startDate: row.startDate ?? undefined,
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

  const taskKey = label === "任务";
  if (!title) {
    throw new DomainError(`请输入${label}标题`, "title", {
      key: taskKey ? "titleRequired" : "subtaskTitleRequired",
    });
  }
  if (title.length > max) {
    throw new DomainError(`${label}标题不能超过 ${max} 个字符`, "title", {
      key: taskKey ? "titleTooLong" : "subtaskTitleTooLong",
      params: { max },
    });
  }

  return title;
}

/** 描述清空统一存 null，读取时映射为 undefined。 */
function validateDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > TASK_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      `任务描述不能超过 ${TASK_DESCRIPTION_MAX_LENGTH} 个字符`,
      "description",
      {
        key: "descriptionTooLong",
        params: { max: TASK_DESCRIPTION_MAX_LENGTH },
      },
    );
  }
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 日期字段（截止 / 开始）只接受 `YYYY-MM-DD`（可在日历中真实存在）或空值。
 *
 * 空字符串 / null / undefined 统一存 null。两个入口共用同一套格式与真实日期校验。
 */
function validateDateString(value: unknown, field: "dueDate" | "startDate"): string | null {
  const label = field === "dueDate" ? "截止日期" : "开始时间";
  const formatKey = field === "dueDate" ? "dueDateFormat" : "startDateFormat";
  const invalidKey = field === "dueDate" ? "dueDateInvalid" : "startDateInvalid";

  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DomainError(`${label}格式应为 YYYY-MM-DD`, field, { key: formatKey });
  }

  const dateValue = value.trim();
  if (!dateValue) return null;
  if (!DUE_DATE_PATTERN.test(dateValue)) {
    throw new DomainError(`${label}格式应为 YYYY-MM-DD`, field, { key: formatKey });
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  const isRealDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day;

  if (!isRealDate) {
    throw new DomainError(`${label}不是有效日期`, field, { key: invalidKey });
  }

  return dateValue;
}

function validateDueDate(value: unknown): string | null {
  return validateDateString(value, "dueDate");
}

function validateStartDate(value: unknown): string | null {
  return validateDateString(value, "startDate");
}

/** 开始时间不得晚于截止时间（两者都有值时）。 */
function assertStartNotAfterDue(
  startDate: string | null,
  dueDate: string | null,
): void {
  if (startDate && dueDate && startDate > dueDate) {
    throw new DomainError("开始时间不能晚于截止时间", "startDate", {
      key: "startAfterDue",
    });
  }
}

/** 状态只允许三态，防止外部传入任意字符串。 */
function validateStatus(value: unknown): TaskStatus {
  if (TASK_STATUSES.includes(value as TaskStatus)) {
    return value as TaskStatus;
  }

  throw new DomainError("任务状态不合法", "status", { key: "statusInvalid" });
}

/** 优先级只允许三档，防止外部传入任意字符串。 */
function validatePriority(value: unknown): TaskPriority {
  if (TASK_PRIORITIES.includes(value as TaskPriority)) {
    return value as TaskPriority;
  }

  throw new DomainError("任务优先级不合法", "priority", {
    key: "priorityInvalid",
  });
}

/** 评论内容去空白后校验 1–2000 字。 */
function validateCommentContent(value: unknown): string {
  const content = typeof value === "string" ? value.trim() : "";

  if (!content) {
    throw new DomainError("请输入评论内容", "content", { key: "commentRequired" });
  }
  if (content.length > COMMENT_MAX_LENGTH) {
    throw new DomainError(
      `评论不能超过 ${COMMENT_MAX_LENGTH} 个字符`,
      "content",
      { key: "commentTooLong", params: { max: COMMENT_MAX_LENGTH } },
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
    throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
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
  const description = validateDescription(input?.description);
  const priority = validatePriority(input?.priority ?? "medium");
  const dueDate = validateDueDate(input?.dueDate);
  const startDate = validateStartDate(input?.startDate);
  const projectId = normalizeProjectId(input?.projectId);

  assertStartNotAfterDue(startDate, dueDate);

  if (projectId && !(await isOwnedPersonalProject(userId, projectId, client))) {
    throw new DomainError("项目不存在或无权访问", "projectId", { key: "projectNotFound" });
  }

  const [row] = await client
    .insert(tasks)
    .values({
      projectId,
      spaceType: "personal",
      title,
      description,
      status: "todo",
      priority,
      assigneeId: userId,
      dueDate,
      startDate,
      createdById: userId,
    })
    .returning();

  if (!row) {
    throw new DomainError("任务创建失败，请稍后重试", undefined, { key: "taskCreateFailed" });
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
      assigneeUsername: users.username,
      assigneeNickname: users.name,
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

  return {
    id: task.id,
    projectId: task.projectId,
    spaceType: "personal",
    title: task.title,
    description: task.description ?? undefined,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    // 展示名：昵称优先，未填写回退到用户名。
    assigneeName: row.assigneeNickname ?? row.assigneeUsername ?? null,
    dueDate: task.dueDate ?? undefined,
    startDate: task.startDate ?? undefined,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    projectName: row.projectName ?? null,
    progress: getTaskProgress({
      status: task.status,
      subtasks: mappedSubtasks,
    }),
    subtasks: mappedSubtasks,
    comments: commentRows.map(
      ({ comment, authorUsername, authorNickname }) => ({
        id: comment.id,
        taskId: comment.taskId,
        authorId: comment.authorId,
        authorName: authorNickname ?? authorUsername,
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
      }),
    ),
  };
}

/**
 * 更新个人任务。
 *
 * 状态只能经此手动流转；未传字段保持不变，更新时刷新 `updatedAt`。
 * 传空描述会清空描述，`dueDate: null` / `startDate: null` 会清空对应日期。
 */
export async function updatePersonalTask(
  userId: string,
  taskId: string,
  input: {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    dueDate?: string | null;
    startDate?: string | null;
    status?: TaskStatus;
  },
  client: DbClient = db,
): Promise<Task> {
  const existing = await requireOwnedPersonalTaskRow(userId, taskId, client);

  const changes: Partial<
    Pick<
      TaskRow,
      "title" | "description" | "priority" | "dueDate" | "startDate" | "status" | "updatedAt"
    >
  > = {};

  if (input?.title !== undefined) {
    changes.title = validateTitle(input.title, "任务");
  }
  if (input?.description !== undefined) {
    changes.description = validateDescription(input.description);
  }
  if (input?.dueDate !== undefined) {
    changes.dueDate = validateDueDate(input.dueDate);
  }
  if (input?.startDate !== undefined) {
    changes.startDate = validateStartDate(input.startDate);
  }
  if (input?.status !== undefined) {
    changes.status = validateStatus(input.status);
  }
  if (input?.priority !== undefined) {
    changes.priority = validatePriority(input.priority);
  }

  // 与新值组合出最终日期对，校验开始不晚于截止。
  assertStartNotAfterDue(
    changes.startDate ?? (existing.startDate ?? null),
    changes.dueDate ?? (existing.dueDate ?? null),
  );

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
    throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
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
    throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
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
    throw new DomainError("任务不存在或无权访问", undefined, { key: "taskNotFound" });
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
    throw new DomainError("子任务创建失败，请稍后重试", undefined, { key: "subtaskCreateFailed" });
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
    throw new DomainError("评论创建失败，请稍后重试", undefined, { key: "commentCreateFailed" });
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
    throw new DomainError("评论不存在或无权删除", undefined, { key: "commentNotFound" });
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
    throw new DomainError("评论不存在或无权删除", undefined, { key: "commentNotFound" });
  }
}
