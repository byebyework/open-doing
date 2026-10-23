import type { Subtask, TaskStatus } from "@open-doing/types";

/** 任务详情里的评论：额外带上作者用户名。 */
export interface TaskDetailComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

/**
 * 任务详情聚合模型（P-4 定稿，J-5 原样复用）。
 *
 * 字段与 V1_TASKS P-4 冻结契约逐字一致；`creatorName` 是控制器批准的
 * 可选扩展：原型详情页的「创建人」行需要展示用户名，个人任务恒为本人，
 * 团队任务由调用方按需填充（缺省时该行不渲染）。
 */
export interface TaskDetailModel {
  id: string;
  projectId: string | null;
  spaceType: "personal" | "team";
  title: string;
  description?: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  projectName: string | null;
  progress: number;
  subtasks: Subtask[];
  comments: TaskDetailComment[];
  /** 创建人用户名；可选扩展，缺省时不渲染「创建人」行。 */
  creatorName?: string;
}

/** 任务详情页的权限位（团队态由 J-5 按角色计算；个人态恒为可编辑 / 可删除）。 */
export interface TaskDetailPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
}

/**
 * 任务详情交互回调（J-5 消费）。
 *
 * `addSubtask` / `removeSubtask` 是 P 轨道对 V1_TASKS 契约的可选扩展：
 * 可选成员不破坏 J-5 的消费，补齐「子任务增删有 UI 入口」的功能要求；
 * INT-1 时与 J 轨道确认。
 */
export interface TaskDetailViewActions {
  toggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  updateStatus: (status: TaskStatus) => Promise<void>;
  updateTask: (input: {
    title: string;
    description?: string;
    dueDate?: string | null;
  }) => Promise<void>;
  deleteTask: () => Promise<void>;
  addComment: (content: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  addSubtask?: (title: string) => Promise<void>;
  removeSubtask?: (subtaskId: string) => Promise<void>;
}

/** TaskDetailView 入参。 */
export interface TaskDetailViewProps {
  task: TaskDetailModel;
  /** personal 时隐藏责任人选择器与管理员类控件。 */
  space: "personal" | "team";
  permissions: TaskDetailPermissions;
  onAction: TaskDetailViewActions;
  /**
   * 「← 返回项目」链接地址：页面按任务归属传入（所属项目页，无项目任务传 `/my`）。
   *
   * 冻结契约本身未包含该字段，但控制器裁决要求页面传入返回地址；
   * 作为**可选**成员追加，不影响 J-5 原样消费（缺省回退到 `/my`）。
   */
  backHref?: string;
  /**
   * 当前登录用户 ID：用于判断评论是否显示「删除」入口。
   *
   * 冻结契约本身未包含当前用户；作为**可选**成员追加，不影响 J-5 原样
   * 消费。缺省时回退为任务责任人（个人任务恒为本人）；团队态应由 J-5
   * 显式传入，避免非责任人看不到自己评论的删除入口。
   */
  currentUserId?: string;
}
