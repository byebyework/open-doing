"use client";

import type { TaskStatus } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { TeamRole } from "@/features/teams/permissions";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";

import { deleteTeamTaskAction, updateTeamTaskAction } from "../actions";
import { canDeleteTask, canEditTask } from "../permissions";
import type { TeamTaskRow } from "../service";

/** 状态展示顺序（列表下拉 / 看板列序共用）。 */
export const TEAM_TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
];

/** 状态 -> `status` 命名空间文案 key（渲染处用 tStatus 翻译）。 */
export const TEAM_TASK_STATUS_KEYS: Record<
  TaskStatus,
  "notStarted" | "inProgress" | "completed"
> = {
  todo: "notStarted",
  in_progress: "inProgress",
  done: "completed",
};

/** Server Action 失败时取第一条可展示文案（兜底文案由调用方按语言传入）。 */
export function firstActionError(
  errors: Record<string, string>,
  fallback: string,
): string {
  return errors.form ?? Object.values(errors)[0] ?? fallback;
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
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [pending, setPending] = useState<TaskStatus | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const permission = { role, actorId, assigneeId: task.assigneeId };
  const editable = canEditTask(permission);
  const deletable = canDeleteTask(permission);

  async function changeStatus(status: TaskStatus) {
    if (pending || status === task.status) return;

    setPending(status);
    try {
      const result = await updateTeamTaskAction(task.id, { teamId, status });

      if (!result.ok) {
        toast.error(firstActionError(result.errors, tErrors("operationFailed")));
        return;
      }

      onChanged();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);

    try {
      const result = await deleteTeamTaskAction({ teamId, taskId: task.id });

      if (!result.ok) {
        toast.error(firstActionError(result.errors, tErrors("operationFailed")));
        return;
      }

      toast.success(t("taskDeleted"));
      setDeleteOpen(false);
      onChanged();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("rowActionsAria", { title: task.title })}
            className="shrink-0 text-[#9aa0a6]"
            disabled={pending !== null || deleting}
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {TEAM_TASK_STATUS_ORDER.map((status) => (
            <DropdownMenuItem
              key={status}
              disabled={!editable || status === task.status}
              onSelect={() => {
                void changeStatus(status);
              }}
            >
              {t("markAs", { status: tStatus(TEAM_TASK_STATUS_KEYS[status]) })}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              router.push(detailHref);
            }}
          >
            {tCommon("edit")}
          </DropdownMenuItem>
          {deletable ? (
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => {
                setDeleteOpen(true);
              }}
            >
              {tCommon("delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmModal
        open={deleteOpen}
        title={t("deleteTask")}
        content={t("deleteRowConfirm", { title: task.title })}
        confirmText={tCommon("delete")}
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
