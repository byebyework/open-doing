/**
 * Open Doing 领域模型
 *
 * 空间层级：用户（默认拥有个人空间） -> 团队空间 -> 项目 -> 任务 -> 子任务 / 评论
 */

/** 任务状态：手动切换 */
export type TaskStatus = "todo" | "in_progress" | "done";

/** 空间类型：个人空间或团队空间 */
export type SpaceType = "personal" | "team";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  createdAt: Date;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
}

/** 团队成员关系 */
export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  joinedAt: Date;
}

/** 团队邀请 */
export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  token: string;
  invitedById: string;
  expiresAt: Date;
  acceptedAt?: Date;
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: Date;
}

/** 子任务：只有已完成 / 未完成两种状态 */
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  assigneeId?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

export interface Task {
  id: string;
  /** 团队任务归属项目；个人任务为 null */
  projectId: string | null;
  /** 任务所属空间：个人空间或团队空间 */
  spaceType: SpaceType;
  title: string;
  description?: string;
  status: TaskStatus;
  assigneeId: string;
  dueDate?: Date;
  subtasks: Subtask[];
  comments: Comment[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 任务进度（0 ~ 1）：
 * - 有子任务：已完成子任务数 / 子任务总数
 * - 无子任务：按状态映射 todo=0, in_progress=0.5, done=1
 */
export function getTaskProgress(task: Pick<Task, "status" | "subtasks">): number {
  if (task.subtasks.length > 0) {
    const completed = task.subtasks.filter((s) => s.completed).length;
    return completed / task.subtasks.length;
  }
  switch (task.status) {
    case "done":
      return 1;
    case "in_progress":
      return 0.5;
    default:
      return 0;
  }
}
