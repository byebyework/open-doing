"use client";

import type { TaskStatus } from "@open-doing/types";
import { Button, Dropdown, message, type MenuProps } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TeamRole } from "@/features/teams/permissions";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { deleteTeamTaskAction, updateTeamTaskAction } from "../actions";
import { canDeleteTask, canEditTask } from "../permissions";
import type { TeamTaskRow } from "../service";

/** 状态展示顺序（列表下拉 / 看板列序共用）。 */
export const TEAM_TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
];

/** 状态的中文文案。 */
export const TEAM_TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "未开始",
  in_progress: "进行中",
  done: "已完成",
};

/** Server Action 失败时取第一条可展示文案。 */
export function firstActionError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
}

/** 行内操作入参。 */
export interface TeamTaskRowActionsProps {
  teamId: string;
  task: TeamTaskRow;
  role: TeamRole;
  actorId: string;
  /** 任务详情页地址（「编辑」跳转目标）。 */
  detailHref: string;
  /** 状态变更 / 删除成功后的回调（父组件刷新服务端数据）。 */
  onChanged: () => void;
}

/**
 * 团队任务行内操作（「⋯」菜单）：标记状态 / 编辑 / 删除。
 *
 * 权限位由纯函数 `canEditTask` / `canDeleteTask` 计算：
 * 成员只能操作指派给自己的任务——无编辑权时整组状态项禁用，
 * 无删除权时不渲染删除项；「编辑」始终保留（详情页对成员只读）。
 */
export function TeamTaskRowActions({
  teamId,
  task,
  role,
  actorId,
  detailHref,
  onChanged,
}: TeamTaskRowActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<TaskStatus | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const permission = { role, actorId, assigneeId: task.assigneeId };
  const editable = canEditTask(permission);
  const deletable = canDeleteTask(permission);

  const items: MenuProps["items"] = [
    ...TEAM_TASK_STATUS_ORDER.map((status) => ({
      key: `status:${status}`,
      label: `标记为${TEAM_TASK_STATUS_LABEL[status]}`,
      disabled: !editable || status === task.status,
    })),
    { type: "divider" as const },
    { key: "edit", label: "编辑" },
    ...(deletable
      ? [{ key: "delete", label: "删除", danger: true }]
      : []),
  ];

  async function changeStatus(status: TaskStatus) {
    if (pending || status === task.status) return;

    setPending(status);
    try {
      const result = await updateTeamTaskAction(task.id, { teamId, status });

      if (!result.ok) {
        message.error(firstActionError(result.errors));
        return;
      }

      onChanged();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setPending(null);
    }
  }

  function handleMenuClick({ key }: { key: string }) {
    if (key === "edit") {
      router.push(detailHref);
      return;
    }
    if (key === "delete") {
      setDeleteOpen(true);
      return;
    }
    if (key.startsWith("status:")) {
      void changeStatus(key.slice("status:".length) as TaskStatus);
    }
  }

  async function handleDelete() {
    setDeleting(true);

    try {
      const result = await deleteTeamTaskAction({ teamId, taskId: task.id });

      if (!result.ok) {
        message.error(firstActionError(result.errors));
        return;
      }

      message.success("任务已删除");
      setDeleteOpen(false);
      onChanged();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        menu={{ items, onClick: handleMenuClick }}
        disabled={pending !== null || deleting}
      >
        <Button
          type="text"
          size="small"
          aria-label={`任务「${task.title}」的操作`}
          className="shrink-0"
          style={{ color: "#9aa0a6" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </Button>
      </Dropdown>

      <ConfirmModal
        open={deleteOpen}
        title="删除任务"
        content={`删除后不可恢复，确定删除「${task.title}」吗？`}
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
