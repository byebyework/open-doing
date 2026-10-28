"use client";

import type { Subtask, Task, TaskStatus } from "@open-doing/types";
import { Button, Dropdown, Segmented, message, type MenuProps } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
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

/** 状态的中文文案。 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "未开始",
  in_progress: "进行中",
  done: "已完成",
};

/** Server Action 失败时取第一条可展示文案。 */
function firstError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
}

/** 行内状态切换的共享逻辑（列表下拉与看板移动端按钮共用）。 */
function useStatusChange(task: ProjectTask, onChanged: () => void) {
  const [pending, setPending] = useState<TaskStatus | null>(null);

  async function change(status: TaskStatus) {
    if (pending || status === task.status) return;

    setPending(status);
    try {
      const result = await updatePersonalTaskAction(task.id, { status });

      if (!result.ok) {
        message.error(firstError(result.errors));
        return;
      }

      onChanged();
    } catch {
      message.error("网络异常，请稍后重试");
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
  const { pending, change } = useStatusChange(task, onChanged);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const items: MenuProps["items"] = [
    ...TASK_STATUS_ORDER.map((status) => ({
      key: `status:${status}`,
      label: `标记为${TASK_STATUS_LABEL[status]}`,
      disabled: status === task.status,
    })),
    { type: "divider" as const },
    { key: "edit", label: "编辑" },
    { key: "delete", label: "删除", danger: true },
  ];

  function handleMenuClick({ key }: { key: string }) {
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
        message.error(firstError(result.errors));
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
  const { pending, change } = useStatusChange(task, onChanged);

  return (
    <div className="flex flex-wrap gap-1.5">
      {TASK_STATUS_ORDER.map((status) => {
        const current = status === task.status;

        return (
          <Button
            key={status}
            size="small"
            type={current ? "primary" : "default"}
            disabled={current || pending !== null}
            loading={pending === status}
            onClick={() => {
              void change(status);
            }}
          >
            {TASK_STATUS_LABEL[status]}
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
 * 「编辑」「删除」→ Segmented「列表 / 看板」→ 主按钮「＋ 新建任务」。
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
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <PersonalProjectHeaderActions project={project} />

      <Segmented<"list" | "board">
        options={[
          { label: "列表", value: "list" },
          { label: "看板", value: "board" },
        ]}
        value={view}
        onChange={(nextView) => {
          router.push(`${projectPath}?view=${nextView}`);
        }}
      />

      <Button type="primary" onClick={() => setNewTaskOpen(true)}>
        ＋ 新建任务
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
