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

/** 任务优先级：三档，默认 medium */
export type TaskPriority = "low" | "medium" | "high";

/** 优先级全集（low → medium → high；排序即索引序，高在前取反） */
export const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high"];

/** 排序语义别名：与 TASK_PRIORITIES 相同（索引越大优先级越高） */
export const TASK_PRIORITY_ORDER = TASK_PRIORITIES;

/** 性别：可选资料，未填写为 null */
export type Gender = "male" | "female" | "secret";

/** 空间类型：个人空间或团队空间 */
export type SpaceType = "personal" | "team";

/** 通知类型 */
export type NotificationType =
  | "team_invite"
  | "team_join_requested"
  | "team_join_approved"
  | "team_join_declined"
  | "task_assigned"
  | "task_due_soon"
  | "task_overdue"
  | "task_commented"
  | "task_changed_by_admin"
  | "task_commented_by_agent"
  | "task_changed_by_agent";

/** 用户：用户名 + 密码登录；昵称 / 性别 / 邮箱 / 电话为可选资料，uid 仅用于邀请 */
export interface User {
  id: string;
  /** 展示用 UID，格式 `doing_xxxx`，仅用于邀请 */
  uid: string;
  /** 用户名：仅用于登录与唯一标识，不再作为展示名 */
  username: string;
  /** 昵称：展示名，可重复；未填写时为 null，展示时回退到 username */
  nickname: string | null;
  /** 性别：可选资料，未填写为 null */
  gender: Gender | null;
  /** 邮箱：可选资料，全库唯一，未填写为 null */
  email: string | null;
  /** 电话：可选资料，全库唯一，未填写为 null */
  phone: string | null;
  /** 系统管理员标记：可访问管理员工作台（管理台权限判定以此为准） */
  isAdmin: boolean;
  /** 禁用标记：禁用即拒绝登录，已有会话在登录校验时被清除 */
  isDisabled: boolean;
  createdAt: string;
}

/** 展示名：昵称优先；昵称为空时回退到用户名（用户名仅用于登录）。 */
export function displayName(user: {
  nickname: string | null;
  username: string;
}): string {
  return user.nickname ?? user.username;
}

/** 团队类型：真实团队，或成员不登录的虚拟团队（agent 团队） */
export type TeamKind = "real" | "virtual";

/** 团队 */
export interface Team {
  id: string;
  name: string;
  slug: string;
  /** 团队类型：虚拟团队复用同一套空间/路由/模块栈，仅以 kind 标记 */
  kind: TeamKind;
  ownerId: string;
  createdAt: string;
}

/**
 * 虚拟成员（团队级 agent 身份）：不属于 users、不能登录，
 * 仅可通过 API Token 代表团队操作；角色仅影响团队内权限。
 */
export interface VirtualMember {
  id: string;
  teamId: string;
  name: string;
  role: "admin" | "member";
  description?: string;
  accentColor: string | null;
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

/**
 * 凭码加入申请状态机：
 * pending（待审批）→ approved / declined（owner/admin 审批）或 cancelled（申请人撤回）。
 * 终态不可再流转；同一用户对同一团队同时只允许一条 pending。
 */
export type TeamJoinStatus = "pending" | "approved" | "declined" | "cancelled";

/** 团队加入申请：用户凭团队加入码发起，由 owner/admin 审批 */
export interface TeamJoinRequest {
  id: string;
  teamId: string;
  userId: string;
  status: TeamJoinStatus;
  createdAt: string;
  /** 审批响应时间；未处理时为空 */
  respondedAt?: string;
  /** 审批人（owner/admin）；未处理时为空 */
  respondedById?: string;
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
  /** 优先级：三档，默认 medium */
  priority: TaskPriority;
  /** 责任人；个人任务恒为本人，未指派时为 null */
  assigneeId: string | null;
  /** 虚拟成员责任人（团队任务可指派给虚拟成员）；与 assigneeId 互斥，未指派时为 null */
  assigneeVirtualId: string | null;
  /** 截止日期，`YYYY-MM-DD` */
  dueDate?: string;
  /** 开始日期，`YYYY-MM-DD`；可空（按天排程，不早于校验在服务层） */
  startDate?: string;
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
  /** 真人作者；虚拟成员评论时为 null */
  authorId: string | null;
  /** 虚拟成员作者；被移除后置 null（与 authorId 不可同时非空） */
  authorVirtualId: string | null;
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
  /** 虚拟成员 actor；与 actorId 不可同时非空，被移除后为空 */
  actorVirtualId?: string;
  createdAt: string;
}

/**
 * 任务责任人引用：真人用户或虚拟成员，二者互斥。
 *
 * 承载展示所需的身份信息，避免下游为了显示责任人名再查库。
 */
export type AssigneeRef =
  | { type: "user"; userId: string; name: string; image: string | null }
  | {
      type: "virtual";
      virtualMemberId: string;
      name: string;
      accentColor: string | null;
    };

/** 责任人展示名：无责任人为 null。 */
export function assigneeRefName(ref: AssigneeRef | null): string | null {
  return ref === null ? null : ref.name;
}

export * from "./progress";
export * from "./project-health";
export * from "./date";
