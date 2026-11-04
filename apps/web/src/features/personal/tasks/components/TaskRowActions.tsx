"use client";

import type { Subtask, Task, TaskStatus } from "@open-doing/types";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { PersonalProjectHeaderActions } from "@/features/personal/projects/components/PersonalProjectHeaderActions";
import { personalTaskHref } from "@/lib/routes";

import {
  deletePersonalTaskAction,
  updatePersonalTaskAction,
} from "../actions";
import { NewTaskModal } from "./NewTaskModal";

/** 项目页使用的任务模型：列表服务返回 Task + 子任务，进度在客户端计算。 */
export type ProjectTask = Task & { subtasks: Subtask[] };

/** 状态展示顺序（看板列顺序 / 行内状态切换顺序）。 */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
];

/** 状态 -> `status` 命名空间文案 key（渲染处用 tStatus 翻译）。 */
export const TASK_STATUS_KEYS: Record<
  TaskStatus,
  "notStarted" | "inProgress" | "completed"
> = {
  todo: "notStarted",
  in_progress: "inProgress",
  done: "completed",
};

/** Server Action 失败时取第一条可展示文案（兜底文案由调用方按语言传入）。 */
function firstError(errors: Record<string, string>, fallback: string): string {
  return errors.form ?? Object.values(errors)[0] ?? fallback;
}

/** 行内状态切换的共享逻辑（列表下拉与看板移动端按钮共用）。 */
function useStatusChange(task: ProjectTask, onChanged: () => void) {
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState<TaskStatus | null>(null);

  async function change(status: TaskStatus) {
    if (pending || status === task.status) return;

    setPending(status);
    try {
      const result = await updatePersonalTaskAction(task.id, { status });

      if (!result.ok) {
        toast.error(firstError(result.errors, tErrors("operationFailed")));
        return;
      }

      onChanged();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setPending(null);
    }
  }

  return { pending, change };
}

/** 列表行内操作入参。 */
export interface TaskRowActionsProps {
  /** 目标任务。 */
  task: ProjectTask;
  /** 状态变更 / 删除成功后的回调（父组件刷新服务端数据）。 */
  onChanged: () => void;
}

/**
 * 列表行内操作：切换状态 / 编辑 / 删除（「⋯」菜单）。
 *
 * 编辑统一跳转任务详情页（Task 4）；删除走 ConfirmModal 二次确认。
 * 原型表格没有操作列，因此入口收在任务标题右侧，不额外占一列。
 */
export function TaskRowActions({ task, onChanged }: TaskRowActionsProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { pending, change } = useStatusChange(task, onChanged);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function handleMenuClick(key: string) {
    if (key === "edit") {
      router.push(personalTaskHref(task.id));
      return;
    }
    if (key === "delete") {
      setDeleteOpen(true);
      return;
    }
    if (key.startsWith("status:")) {
      void change(key.slice("status:".length) as TaskStatus);
    }
  }

  async function handleDelete() {
    setDeleting(true);

    try {
      const result = await deletePersonalTaskAction(task.id);

      if (!result.ok) {
        toast.error(firstError(result.errors, tErrors("operationFailed")));
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
        <DropdownMenuTrigger asChild disabled={pending !== null || deleting}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-[var(--ink-400)]"
            aria-label={t("rowActionsAria", { title: task.title })}
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
          {TASK_STATUS_ORDER.map((status) => (
            <DropdownMenuItem
              key={`status:${status}`}
              disabled={status === task.status}
              onClick={() => {
                handleMenuClick(`status:${status}`);
              }}
            >
              {t("markAs", { status: tStatus(TASK_STATUS_KEYS[status]) })}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleMenuClick("edit")}>
            {tCommon("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => handleMenuClick("delete")}
          >
            {tCommon("delete")}
          </DropdownMenuItem>
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

/** 看板移动端状态按钮入参。 */
export interface TaskStatusButtonsProps {
  /** 目标任务。 */
  task: ProjectTask;
  /** 状态变更成功后的回调。 */
  onChanged: () => void;
}

/**
 * 看板移动端（<861px）的状态切换按钮。
 *
 * 375px 下单列展示不要求拖拽，用列内按钮完成手动状态流转。
 */
export function TaskStatusButtons({
  task,
  onChanged,
}: TaskStatusButtonsProps) {
  const tStatus = useTranslations("status");
  const { pending, change } = useStatusChange(task, onChanged);

  return (
    <div className="flex flex-wrap gap-1.5">
      {TASK_STATUS_ORDER.map((status) => {
        const current = status === task.status;

        return (
          <Button
            key={status}
            size="sm"
            variant={current ? "default" : "outline"}
            disabled={current || pending !== null}
            onClick={() => {
              void change(status);
            }}
          >
            {pending === status ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : null}
            {tStatus(TASK_STATUS_KEYS[status])}
          </Button>
        );
      })}
    </div>
  );
}

/** 项目页页头操作区入参。 */
export interface PersonalProjectPageActionsProps {
  /** 当前项目（编辑 / 删除复用 Task 1 的操作区）。 */
  project: { id: string; name: string; description?: string };
  /** 项目页路径，用于写 `?view=`。 */
  projectPath: string;
  /** 当前视图：列表 / 看板。 */
  view: "list" | "board";
  /** 新建任务弹窗可选的个人项目。 */
  projects: { id: string; name: string }[];
}

/**
 * 项目页页头操作区（从左到右）：
 * 「编辑」「删除」→ 视图切换「列表 / 看板」→ 主按钮「＋ 新建任务」。
 *
 * 新建任务弹窗默认选中当前项目；视图切换写 `?view=list|board`。
 */
export function PersonalProjectPageActions({
  project,
  projectPath,
  view,
  projects,
}: PersonalProjectPageActionsProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <PersonalProjectHeaderActions project={project} />

      <Tabs value={view} onValueChange={(nextView) => {
        if (nextView === "list" || nextView === "board") {
          router.push(`${projectPath}?view=${nextView}`);
        }
      }}>
        <TabsList>
          <TabsTrigger value="list">{t("viewList")}</TabsTrigger>
          <TabsTrigger value="board">{t("viewBoard")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Button data-testid="new-task-button" onClick={() => setNewTaskOpen(true)}>
        {t("newTaskButton")}
      </Button>

      <NewTaskModal
        open={newTaskOpen}
        projects={projects}
        defaultProjectId={project.id}
        onSuccess={() => {
          setNewTaskOpen(false);
          router.refresh();
        }}
        onCancel={() => setNewTaskOpen(false)}
      />
    </div>
  );
}
