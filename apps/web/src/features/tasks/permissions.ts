import type { TeamRole } from "@/features/teams/permissions";

/**
 * 团队任务权限（纯函数，禁止 import DB）。
 *
 * 规则（设计 §5 任务矩阵）：
 * - 任何团队成员都能建任务、发评论；
 * - 任务的内容编辑 / 删除 / 改派：owner、admin 可操作任意任务，
 *   member 只能操作**指派给自己的**任务（未指派任务 member 不可操作）。
 *
 * 这里只做类型擦除引用 `TeamRole`：`features/teams/permissions` 含 DB
 * import，纯函数模块不能把连接池带进来。
 */

/** 任务级动作（与 `TeamAction` 区分：J 轨道新增的任务粒度动作）。 */
export type TaskAction = "task:edit" | "task:delete" | "task:assign";

/** 任务级权限错误：action 层统一映射为「没有权限执行该操作」。 */
export class TaskPermissionError extends Error {
  readonly action: TaskAction;

  constructor(action: TaskAction) {
    super("没有权限执行该操作");
    this.name = "TaskPermissionError";
    this.action = action;
  }
}

/** 任务操作权限判定的公共入参。 */
export interface TaskPermissionInput {
  role: TeamRole | null;
  actorId: string;
  assigneeId: string | null;
}

/** 任何团队成员都能建任务。 */
export function canCreateTask(role: TeamRole | null): boolean {
  return role !== null;
}

/** 任何团队成员都能评论。 */
export function canComment(role: TeamRole | null): boolean {
  return role !== null;
}

/** owner/admin 任意任务；member 仅本人任务。 */
function isTaskOwnerOrAssignee(input: TaskPermissionInput): boolean {
  const { role, actorId, assigneeId } = input;
  if (role === "owner" || role === "admin") return true;
  if (role !== "member") return false;
  return assigneeId !== null && assigneeId === actorId;
}

/** 编辑任务内容（标题 / 描述 / 截止日期 / 状态）。 */
export function canEditTask(input: TaskPermissionInput): boolean {
  return isTaskOwnerOrAssignee(input);
}

/** 删除任务。 */
export function canDeleteTask(input: TaskPermissionInput): boolean {
  return isTaskOwnerOrAssignee(input);
}

/** 改派责任人。 */
export function canAssignTask(input: TaskPermissionInput): boolean {
  return isTaskOwnerOrAssignee(input);
}

/** 断言可编辑，否则抛 `TaskPermissionError("task:edit")`。 */
export function assertCanEditTask(input: TaskPermissionInput): void {
  if (!canEditTask(input)) throw new TaskPermissionError("task:edit");
}

/** 断言可删除，否则抛 `TaskPermissionError("task:delete")`。 */
export function assertCanDeleteTask(input: TaskPermissionInput): void {
  if (!canDeleteTask(input)) throw new TaskPermissionError("task:delete");
}

/** 断言可改派，否则抛 `TaskPermissionError("task:assign")`。 */
export function assertCanAssignTask(input: TaskPermissionInput): void {
  if (!canAssignTask(input)) throw new TaskPermissionError("task:assign");
}
