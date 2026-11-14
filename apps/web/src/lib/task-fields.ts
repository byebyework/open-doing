import type { TaskPriority, TaskStatus } from "@open-doing/types";

import { DomainError } from "@/lib/domain-error";

/**
 * 任务字段校验（团队任务轨道 J 专用）。
 *
 * 与个人任务轨道 `features/personal/tasks/service.ts` 的规则逐字一致；
 * J 轨道不改动个人目录，故在此抽出共享纯函数供团队任务复用。
 */

/** 任务标题长度上限（与表单校验一致）。 */
export const TASK_TITLE_MAX_LENGTH = 200;

/** 子任务标题长度上限（2026-11-14 收紧：200 → 100）。 */
export const SUBTASK_TITLE_MAX_LENGTH = 100;

/** 任务描述长度上限（2026-11-14 新增）。 */
export const TASK_DESCRIPTION_MAX_LENGTH = 800;

/** 评论内容长度上限（2026-11-14 收紧：2000 → 500）。 */
export const COMMENT_MAX_LENGTH = 500;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 任务状态全集（用于运行时校验）。 */
const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** 任务优先级全集（用于运行时校验）。 */
const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high"];

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

/** 描述清空统一存 null，读取时映射为 undefined；超长（>800）按 descriptionTooLong 拒绝。 */
export function validateTaskDescription(value: unknown): string | null {
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
 * 任务日期字段（截止 / 开始）只接受 `YYYY-MM-DD`（可在日历中真实存在）或空值。
 *
 * 空字符串 / null / undefined 统一存 null。两个入口共用同一套格式与真实日期校验。
 */
function validateTaskDateString(
  value: unknown,
  field: "dueDate" | "startDate",
): string | null {
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

/** 截止日期只接受 `YYYY-MM-DD` 或空值（空字符串 / null / undefined 统一存 null）。 */
export function validateTaskDueDate(value: unknown): string | null {
  return validateTaskDateString(value, "dueDate");
}

/** 开始日期只接受 `YYYY-MM-DD` 或空值（空字符串 / null / undefined 统一存 null）。 */
export function validateTaskStartDate(value: unknown): string | null {
  return validateTaskDateString(value, "startDate");
}

/** 开始时间不得晚于截止时间（两者都有值时）。 */
export function assertStartNotAfterTaskDue(
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
export function validateTaskStatus(value: unknown): TaskStatus {
  if (TASK_STATUSES.includes(value as TaskStatus)) {
    return value as TaskStatus;
  }

  throw new DomainError("任务状态不合法", "status", { key: "statusInvalid" });
}

/** 优先级只允许三档，防止外部传入任意字符串。 */
export function validateTaskPriority(value: unknown): TaskPriority {
  if (TASK_PRIORITIES.includes(value as TaskPriority)) {
    return value as TaskPriority;
  }

  throw new DomainError("任务优先级不合法", "priority", {
    key: "priorityInvalid",
  });
}

/** 评论内容去空白后校验 1–2000 字。 */
export function validateCommentContent(value: unknown): string {
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
