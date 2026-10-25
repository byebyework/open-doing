"use client";

import { message } from "antd";
import { useRouter } from "next/navigation";

import { TaskDetailView } from "@/components/ui/task-detail/TaskDetailView";
import type {
  TaskDetailModel,
  TaskDetailViewActions,
} from "@/components/ui/task-detail/types";
import type { ActionResult } from "@/features/auth/actions";

import {
  addPersonalCommentAction,
  addPersonalSubtaskAction,
  deletePersonalCommentAction,
  deletePersonalTaskAction,
  removePersonalSubtaskAction,
  togglePersonalSubtaskAction,
  updatePersonalTaskAction,
} from "../actions";

/** Server Action 失败时取第一条可展示文案。 */
function firstError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
}

/**
 * 包装件内部用于「提示后仍把失败抛给 UI」的错误。
 *
 * `TaskDetailView` / `SubtaskList` / `CommentBox` 会在失败时回滚乐观状态
 * 或保持弹窗打开，因此提示文案只在这里出一次。
 */
class DetailActionError extends Error {
  constructor(text: string) {
    super(text);
    this.name = "DetailActionError";
  }
}

/** 执行 Server Action：失败统一 `message.error`，并向调用方抛出。 */
async function runAction<T>(
  operation: () => Promise<ActionResult<T>>,
): Promise<void> {
  let result: ActionResult<T>;

  try {
    result = await operation();
  } catch {
    message.error("网络异常，请稍后重试");
    throw new DetailActionError("网络异常，请稍后重试");
  }

  if (!result.ok) {
    const text = firstError(result.errors);
    message.error(text);
    throw new DetailActionError(text);
  }
}

/** 个人任务详情页 client 包装件入参。 */
export interface TaskDetailClientProps {
  /** 服务端组装的详情模型（已补充 `creatorName`）。 */
  task: TaskDetailModel;
  /** 「← 返回项目」地址：所属项目页，或 `/my`。 */
  backHref: string;
  /** 返回链接文案；无项目任务传「← 返回我的任务」。 */
  backLabel?: string;
  /** 当前登录用户 ID（个人任务恒为责任人）。 */
  currentUserId: string;
}

/**
 * 个人任务详情页包装件：把共享件 `TaskDetailView` 的 `onAction`
 * 映射到个人空间 Server Actions，并在成功后刷新服务端数据。
 *
 * 删除任务例外：跳转离开由 `TaskDetailView` 负责，避免先刷新已删除的
 * 详情页造成 404 闪屏。
 */
export function TaskDetailClient({
  task,
  backHref,
  backLabel,
  currentUserId,
}: TaskDetailClientProps) {
  const router = useRouter();

  const onAction: TaskDetailViewActions = {
    toggleSubtask: async (subtaskId, completed) => {
      await runAction(() =>
        togglePersonalSubtaskAction(task.id, subtaskId, completed),
      );
      router.refresh();
    },
    updateStatus: async (status) => {
      await runAction(() =>
        updatePersonalTaskAction(task.id, { status }),
      );
      router.refresh();
    },
    updateTask: async (input) => {
      await runAction(() => updatePersonalTaskAction(task.id, input));
      router.refresh();
    },
    deleteTask: async () => {
      await runAction(() => deletePersonalTaskAction(task.id));
    },
    addComment: async (content) => {
      await runAction(() => addPersonalCommentAction(task.id, content));
      router.refresh();
    },
    deleteComment: async (commentId) => {
      await runAction(() =>
        deletePersonalCommentAction(task.id, commentId),
      );
      router.refresh();
    },
    addSubtask: async (title) => {
      await runAction(() => addPersonalSubtaskAction(task.id, title));
      router.refresh();
    },
    removeSubtask: async (subtaskId) => {
      await runAction(() =>
        removePersonalSubtaskAction(task.id, subtaskId),
      );
      router.refresh();
    },
  };

  return (
    <TaskDetailView
      task={task}
      space="personal"
      permissions={{ canEdit: true, canDelete: true, canAssign: false }}
      onAction={onAction}
      backHref={backHref}
      backLabel={backLabel}
      currentUserId={currentUserId}
    />
  );
}
