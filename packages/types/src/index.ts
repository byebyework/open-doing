/**
 * Open Doing 共享领域模型
 *
 * 本包只包含可序列化类型 + 纯函数：无 IO、无 React。
 * 所有时间戳字段均为 string（可序列化 ISO 字符串）；
 * 截止日期（dueDate）为 `YYYY-MM-DD` 字符串。
 *
 * 空间层级：用户（默认拥有个人空间） -> 团队空间 -> 项目 -> 任务 -> 子任务 / 评论
 */

/** 任务状态：手动切换 */
export type TaskStatus = "todo" | "in_progress" | "done";

/** 空间类型：个人空间或团队空间 */
export type SpaceType = "personal" | "team";

/** 通知类型 */
export type NotificationType =
  | "team_invite"
  | "task_assigned"
  | "task_due_soon"
  | "task_overdue"
  | "task_commented"
  | "task_changed_by_admin";

/** 用户：仅用户名 + 密码登录，不收集邮箱 */
export interface User {
  id: string;
  /** 展示用 UID，格式 `doing_xxxx`，仅用于邀请 */
  uid: string;
  /** 用户名，同时作为显示名 */
  username: string;
  createdAt: string;
}

/** 团队 */
export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

/** 团队成员关系 */
export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

/** 团队邀请 */
export interface TeamInvite {
  id: string;
  teamId: string;
  inviteeId: string;
  invitedById: string;
  status: "pending" | "accepted" | "declined" | "rescinded";
  createdAt: string;
  respondedAt?: string;
}

/** 项目：团队项目归团队，个人项目归用户，二者必居其一 */
export interface Project {
  id: string;
  /** 团队项目所属团队；个人项目为 null */
  teamId: string | null;
  /** 个人项目归属用户；团队项目为 null */
  ownerId: string | null;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
}

/** 任务 */
export interface Task {
  id: string;
  /** 团队任务归属项目；个人任务为 null */
  projectId: string | null;
  /** 任务所属空间：个人空间或团队空间 */
  spaceType: SpaceType;
  title: string;
  description?: string;
  status: TaskStatus;
  /** 责任人；个人任务恒为本人，未指派时为 null */
  assigneeId: string | null;
  /** 截止日期，`YYYY-MM-DD` */
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

/** 子任务：只有已完成 / 未完成两种状态，无责任人、无截止日期 */
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

/** 任务评论 */
export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

/** 通知 */
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  read: boolean;
  teamId?: string;
  projectId?: string;
  taskId?: string;
  actorId?: string;
  createdAt: string;
}

export * from "./progress";
export * from "./date";
