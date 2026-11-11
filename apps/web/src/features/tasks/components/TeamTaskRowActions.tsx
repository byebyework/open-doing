"use client";

import type { TaskStatus } from "@open-doing/types";
import { ChevronDownIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { TeamRole } from "@/features/teams/permissions";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { StatusTag } from "@/components/ui/StatusTag";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";

import { deleteTeamTaskAction, updateTeamTaskAction } from "../actions";
import { canDeleteTask, canEditTask } from "../permissions";
import type { TeamTaskRow } from "../service";

/** 状态展示顺序（列表徽标菜单 / 看板列序共用）。 */
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

/** 状态徽标菜单入参。 */
export interface TeamTaskStatusMenuProps {
  teamId: string;
  task: TeamTaskRow;
  role: TeamRole;
  actorId: string;
  /** 状态变更成功后的回调（父组件刷新服务端数据）。 */
  onChanged: () => void;
}

/**
 * 团队任务状态列的可点徽标（spec D2）：点击弹三态菜单，当前态高亮。
 *
 * 权限位由 `canEditTask` 计算——成员只能改指派给自己的任务，
 * 无编辑权时 trigger 禁用，徽标退化为纯展示。
 */
export function TeamTaskStatusMenu({
  teamId,
  task,
  role,
  actorId,
  onChanged,
}: TeamTaskStatusMenuProps) {
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [pending, setPending] = useState<TaskStatus | null>(null);

  const editable = canEditTask({ role, actorId, assigneeId: task.assigneeId });

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!editable || pending !== null}>
        <button
          type="button"
          aria-label={t("statusMenuAria", { title: task.title })}
          data-testid="status-menu-trigger"
          className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-pill)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:cursor-default"
        >
          <StatusTag status={task.status} />
          <ChevronDownIcon
            aria-hidden
            className={`size-3 text-[var(--ink-400)] ${
              editable ? "" : "opacity-0"
            }`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TEAM_TASK_STATUS_ORDER.map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={status === task.status}
            className={status === task.status ? "font-semibold" : ""}
            onSelect={() => {
              void changeStatus(status);
            }}
          >
            {tStatus(TEAM_TASK_STATUS_KEYS[status])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 操作列单元格入参。 */
export interface TeamTaskRowActionsProps {
  teamId: string;
  task: TeamTaskRow;
  role: TeamRole;
  actorId: string;
  /** 任务详情页地址（「编辑」跳转目标）。 */
  detailHref: string;
  /** 删除成功后的回调（父组件刷新服务端数据）。 */
  onChanged: () => void;
}

/**
 * 团队任务「操作」列单元格（spec D1）：编辑铅笔（恒显，跳转详情页，
 * 成员只读）+ 删除垃圾桶（仅 `canDeleteTask`，二次确认）。
 *
 * 原型的「⋯」下拉由显式操作列与 `TeamTaskStatusMenu` 替代。
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
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deletable = canDeleteTask({ role, actorId, assigneeId: task.assigneeId });

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
      <div className="flex items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-[var(--ink-400)]"
          aria-label={t("editTaskAria", { title: task.title })}
          data-testid="row-edit"
          onClick={() => {
            router.push(detailHref);
          }}
        >
          <PencilIcon aria-hidden className="size-4" />
        </Button>
        {deletable ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-[var(--ink-400)] hover:text-destructive"
            aria-label={t("deleteTaskAria", { title: task.title })}
            data-testid="row-delete"
            disabled={deleting}
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            <Trash2Icon aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>

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
