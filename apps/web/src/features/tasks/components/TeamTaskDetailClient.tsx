"use client";

import { message } from "antd";
import { useRouter } from "next/navigation";

import { TaskDetailView } from "@/components/ui/task-detail/TaskDetailView";
import type {
  TaskDetailModel,
  TaskDetailPermissions,
  TaskDetailViewActions,
} from "@/components/ui/task-detail/types";
import type { ActionResult } from "@/features/auth/actions";

import {
  addTeamCommentAction,
  addTeamSubtaskAction,
  deleteTeamCommentAction,
  deleteTeamTaskAction,
  removeTeamSubtaskAction,
  toggleTeamSubtaskAction,
  updateTeamTaskAction,
} from "../actions";

/** Server Action 失败时取第一条可展示文案。 */
function firstError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
}

/**
 * 包装件内部用于「提示后仍把失败抛给 UI」的错误。
 *
 * `TaskDetailView` 会在失败时回滚乐观状态或保持弹窗打开，
 * 因此提示文案只在这里出一次。
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

/** 团队任务详情页 client 包装件入参。 */
export interface TeamTaskDetailClientProps {
  /** 服务端组装的详情模型（含 `creatorName`）。 */
  task: TaskDetailModel;
  teamId: string;
  /** 「← 返回项目」地址。 */
  backHref: string;
  /** 当前登录用户 ID（评论删除入口用）。 */
  currentUserId: string;
  /** 服务端按角色计算的权限位。 */
  permissions: TaskDetailPermissions;
  /** 团队成员（责任人选择器选项）。 */
  assigneeOptions: { id: string; name: string }[];
}

/**
 * 团队任务详情页包装件：把共享件 `TaskDetailView` 的 `onAction` / `onAssign`
 * 映射到团队任务 Server Actions，并在成功后刷新服务端数据。
 *
 * 删除任务例外：跳转离开由 `TaskDetailView` 负责，避免先刷新已删除的
 * 详情页造成 404 闪屏。
 */
export function TeamTaskDetailClient({
  task,
  teamId,
  backHref,
  currentUserId,
  permissions,
  assigneeOptions,
}: TeamTaskDetailClientProps) {
  const router = useRouter();

  const onAction: TaskDetailViewActions = {
    toggleSubtask: async (subtaskId, completed) => {
      await runAction(() =>
        toggleTeamSubtaskAction({
          teamId,
          taskId: task.id,
          subtaskId,
          completed,
        }),
      );
      router.refresh();
    },
    updateStatus: async (status) => {
      await runAction(() =>
        updateTeamTaskAction(task.id, { teamId, status }),
      );
      router.refresh();
    },
    updateTask: async (input) => {
      await runAction(() => updateTeamTaskAction(task.id, { teamId, ...input }));
      router.refresh();
    },
    deleteTask: async () => {
      await runAction(() => deleteTeamTaskAction({ teamId, taskId: task.id }));
    },
    addComment: async (content) => {
      await runAction(() =>
        addTeamCommentAction({ teamId, taskId: task.id, content }),
      );
      router.refresh();
    },
    deleteComment: async (commentId) => {
      await runAction(() =>
        deleteTeamCommentAction({ teamId, taskId: task.id, commentId }),
      );
      router.refresh();
    },
    addSubtask: async (title) => {
      await runAction(() =>
        addTeamSubtaskAction({ teamId, taskId: task.id, title }),
      );
      router.refresh();
    },
    removeSubtask: async (subtaskId) => {
      await runAction(() =>
        removeTeamSubtaskAction({ teamId, taskId: task.id, subtaskId }),
      );
      router.refresh();
    },
  };

  async function handleAssign(assigneeId: string) {
    await runAction(() =>
      updateTeamTaskAction(task.id, { teamId, assigneeId }),
    );
    router.refresh();
  }

  return (
    <TaskDetailView
      task={task}
      space="team"
      permissions={permissions}
      onAction={onAction}
      backHref={backHref}
      currentUserId={currentUserId}
      assigneeOptions={assigneeOptions}
      onAssign={handleAssign}
    />
  );
}
