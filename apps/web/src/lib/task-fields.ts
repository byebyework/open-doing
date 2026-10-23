import type { TaskStatus } from "@open-doing/types";

import { DomainError } from "@/lib/domain-error";

/**
 * 任务字段校验（团队任务轨道 J 专用）。
 *
 * 与个人任务轨道 `features/personal/tasks/service.ts` 的规则逐字一致；
 * J 轨道不改动个人目录，故在此抽出共享纯函数供团队任务复用。
 */

/** 任务标题长度上限（与表单校验一致）。 */
export const TASK_TITLE_MAX_LENGTH = 200;

/** 子任务标题长度上限（与任务标题保持一致）。 */
export const SUBTASK_TITLE_MAX_LENGTH = 200;

/** 评论内容长度上限（与表单校验一致）。 */
export const COMMENT_MAX_LENGTH = 2000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 任务状态全集（用于运行时校验）。 */
const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** 路由参数可能不是 UUID（例如手工拼出的地址），提前拦截。 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** 标题去空白后校验 1–200 字；`label` 决定错误文案（任务 / 子任务）。 */
export function validateTaskTitle(
  value: unknown,
  label: "任务" | "子任务" = "任务",
): string {
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
export function normalizeTaskDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 截止日期只接受 `YYYY-MM-DD`（可在日历中真实存在）或空值。
 *
 * 空字符串 / null / undefined 统一存 null。
 */
export function validateTaskDueDate(value: unknown): string | null {
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
export function validateTaskStatus(value: unknown): TaskStatus {
  if (TASK_STATUSES.includes(value as TaskStatus)) {
    return value as TaskStatus;
  }

  throw new DomainError("任务状态不合法", "status");
}

/** 评论内容去空白后校验 1–2000 字。 */
export function validateCommentContent(value: unknown): string {
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
