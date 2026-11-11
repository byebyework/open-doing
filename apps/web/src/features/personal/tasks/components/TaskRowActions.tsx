"use client";

import type { Subtask, Task, TaskStatus } from "@open-doing/types";
import { ChevronDownIcon, Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { StatusTag } from "@/components/ui/StatusTag";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

/** 行内状态切换的共享逻辑（状态徽标菜单与看板移动端按钮共用）。 */
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

/** 状态徽标菜单入参。 */
export interface TaskStatusMenuProps {
  /** 目标任务。 */
  task: ProjectTask;
  /** 状态变更成功后的回调（父组件刷新服务端数据）。 */
  onChanged: () => void;
  /** 无编辑权时整组禁用（个人列表恒为 true，团队列表按权限传入）。 */
  editable?: boolean;
}

/**
 * 状态列的可点徽标（spec D2）：点击弹三态菜单，当前态高亮。
 *
 * 菜单优于循环切换——避免一次点击跨多个状态；无编辑权时 trigger 禁用，
 * 徽标退化为纯展示。
 */
export function TaskStatusMenu({
  task,
  onChanged,
  editable = true,
}: TaskStatusMenuProps) {
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const { pending, change } = useStatusChange(task, onChanged);

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
        {TASK_STATUS_ORDER.map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={status === task.status}
            className={status === task.status ? "font-semibold" : ""}
            onClick={() => {
              void change(status);
            }}
          >
            {tStatus(TASK_STATUS_KEYS[status])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 操作列单元格入参。 */
export interface TaskRowActionsProps {
  /** 目标任务。 */
  task: ProjectTask;
  /** 删除成功后的回调（父组件刷新服务端数据）。 */
  onChanged: () => void;
  /** 无删除权时不渲染删除图标（spec D1；个人列表恒为 true）。 */
  deletable?: boolean;
}

/**
 * 列表「操作」列单元格（spec D1）：编辑铅笔（恒显，跳转详情页）+
 * 删除垃圾桶（仅 deletable，二次确认）。
 *
 * 原型的「⋯」下拉由显式操作列与本文件的 `TaskStatusMenu` 替代。
 */
export function TaskRowActions({
  task,
  onChanged,
  deletable = true,
}: TaskRowActionsProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      <div className="flex items-center justify-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-[var(--ink-400)]"
          aria-label={t("editTaskAria", { title: task.title })}
          data-testid="row-edit"
          onClick={() => {
            router.push(personalTaskHref(task.id));
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
