"use client";

import type { TaskStatus } from "@open-doing/types";
import { getTaskProgress } from "@open-doing/types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

import { DueText } from "@/components/ui/DueText";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";

import { updatePersonalTaskAction } from "../actions";
import { NewTaskModal } from "./NewTaskModal";
import {
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  TaskStatusButtons,
  type ProjectTask,
} from "./TaskRowActions";

/** Server Action 失败时取第一条可展示文案。 */
function firstError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
}

/** 看板视图入参。 */
export interface PersonalKanbanProps {
  /** 项目全部任务。 */
  tasks: ProjectTask[];
  /** 今天（Asia/Shanghai，`YYYY-MM-DD`）。 */
  today: string;
  /** 当前项目 ID（新建任务默认选中）。 */
  projectId: string;
  /** 新建任务弹窗可选的全部个人项目。 */
  projects: { id: string; name: string }[];
}

/** 与 Tailwind `min-[861px]` 断点保持一致：仅桌面端启用拖拽。 */
const DESKTOP_MEDIA_QUERY = "(min-width: 861px)";

function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  query.addEventListener("change", callback);

  return () => query.removeEventListener("change", callback);
}

function getDesktopSnapshot() {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/** 服务端（及水合首帧）按窄屏处理：不渲染任何拖拽行为。 */
function getDesktopServerSnapshot() {
  return false;
}

/**
 * 是否处于桌面宽度。
 *
 * 窄屏下看板退化为单列 + 状态按钮，卡片主体必须把触摸滚动交还浏览器：
 * 拖拽监听会吞掉 touch 滚动，因此按断点整体关闭，而不是仅隐藏样式。
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getDesktopServerSnapshot,
  );
}

/** 可拖拽的任务卡片。 */
function KanbanCard({
  task,
  today,
  draggable,
  onChanged,
}: {
  task: ProjectTask;
  today: string;
  draggable: boolean;
  onChanged: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id, disabled: !draggable });

  const done = task.status === "done";
  const hasSubtasks = task.subtasks.length > 0;
  const completedCount = task.subtasks.filter(
    (subtask) => subtask.completed,
  ).length;
  const progress = getTaskProgress({
    status: task.status,
    subtasks: task.subtasks,
  });

  const left = done ? (
    <StatusTag status="done" />
  ) : hasSubtasks ? (
    <span className="text-[12px] text-[#5f6368]">
      {completedCount}/{task.subtasks.length}
    </span>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-xl border border-[#e1e3e6] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(14,19,24,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(14,19,24,0.08)] ${
        isDragging ? "opacity-50" : ""
      } ${done ? "opacity-[0.62]" : ""}`}
    >
      {/* 拖拽把手覆盖卡片主体（标题 / 进度 / 截止）；移动端状态按钮留在把手外。
          窄屏不挂拖拽监听，且 touch-action 保持默认，让浏览器接管纵向滚动。 */}
      <div
        {...(draggable ? attributes : {})}
        {...listeners}
        aria-label={task.title}
        className={`select-none min-[861px]:cursor-grab min-[861px]:touch-none ${
          draggable ? "" : "cursor-auto"
        }`}
      >
        <div
          className={`text-[13.5px] font-semibold leading-[1.35] ${
            done ? "text-[#9aa0a6] line-through" : "text-[#0e1318]"
          }`}
        >
          {task.title}
        </div>

        {hasSubtasks ? (
          <div className="mb-2.5 mt-2">
            <ProgressBar value={progress} />
          </div>
        ) : null}

        <div
          className={`mt-2.5 flex items-center gap-2 ${
            left ? "justify-between" : "justify-start"
          }`}
        >
          {left}
          {task.dueDate ? (
            <DueText dueDate={task.dueDate} status={task.status} today={today} />
          ) : (
            <span className="text-[12.5px] text-[#9aa0a6]">—</span>
          )}
        </div>
      </div>

      <div className="mt-2.5 min-[861px]:hidden">
        <TaskStatusButtons task={task} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** 看板单列（同时是拖放目标）。 */
function KanbanColumn({
  status,
  tasks,
  today,
  draggable,
  onNewTask,
  onChanged,
}: {
  status: TaskStatus;
  tasks: ProjectTask[];
  today: string;
  draggable: boolean;
  onNewTask: () => void;
  onChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={TASK_STATUS_LABEL[status]}
      className={`min-w-0 rounded-2xl p-3 transition-colors ${
        isOver
          ? "bg-[#eef0fc] outline outline-2 outline-dashed outline-offset-[-4px] outline-[#7d2ae8]"
          : "bg-[#f4f5f7]"
      }`}
    >
      <header className="flex items-center gap-2 px-2 pb-3 pt-1">
        <span className="text-[13.5px] font-bold text-[#0e1318]">
          {TASK_STATUS_LABEL[status]}
        </span>
        <span className="rounded-full bg-[#e8eaed] px-2 py-0.5 text-[11px] font-bold text-[#5f6368]">
          {tasks.length}
        </span>
        {status === "todo" ? (
          <Button
            type="text"
            size="small"
            className="ml-auto"
            aria-label="新建任务"
            onClick={onNewTask}
          >
            ＋
          </Button>
        ) : null}
      </header>

      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#e1e3e6] px-3 py-4 text-center text-[12.5px] text-[#9aa0a6]">
            暂无任务
          </p>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              today={today}
              draggable={draggable}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * 个人项目看板视图（对照 `personal-project-board.html`）。
 *
 * 三列「未开始 / 进行中 / 已完成」；拖卡落列即乐观更新状态，
 * 失败回滚并 `message.error`。≥861px 三列可拖拽，窄屏单列并提供
 * 列内状态按钮（不要求拖拽）。
 */
export function PersonalKanban({
  tasks,
  today,
  projectId,
  projects,
}: PersonalKanbanProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [items, setItems] = useState<ProjectTask[]>(tasks);
  const [syncedTasks, setSyncedTasks] = useState<ProjectTask[]>(tasks);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // 服务端刷新（router.refresh / 其他操作）后以最新 props 为准。
  // 渲染期同步 props → state 是 React 推荐的「props 变化时调整 state」写法，
  // 避免在 effect 中 setState 造成额外一轮渲染。
  if (tasks !== syncedTasks) {
    setSyncedTasks(tasks);
    setItems(tasks);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const grouped = useMemo(() => {
    const result: Record<TaskStatus, ProjectTask[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };

    for (const task of items) {
      result[task.status].push(task);
    }

    return result;
  }, [items]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const nextStatus = String(over.id) as TaskStatus;
    if (!TASK_STATUS_ORDER.includes(nextStatus)) return;

    const task = items.find((item) => item.id === taskId);
    if (!task || task.status === nextStatus) return;

    const previousStatus = task.status;
    setItems((current) =>
      current.map((item) =>
        item.id === taskId ? { ...item, status: nextStatus } : item,
      ),
    );

    try {
      const result = await updatePersonalTaskAction(taskId, {
        status: nextStatus,
      });

      if (!result.ok) {
        setItems((current) =>
          current.map((item) =>
            item.id === taskId ? { ...item, status: previousStatus } : item,
          ),
        );
        message.error(firstError(result.errors));
        return;
      }

      router.refresh();
    } catch {
      setItems((current) =>
        current.map((item) =>
          item.id === taskId ? { ...item, status: previousStatus } : item,
        ),
      );
      message.error("网络异常，请稍后重试");
    }
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={(event) => {
          void handleDragEnd(event);
        }}
      >
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[861px]:grid-cols-3">
          {TASK_STATUS_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={grouped[status]}
              today={today}
              draggable={isDesktop}
              onNewTask={() => setNewTaskOpen(true)}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      </DndContext>

      <NewTaskModal
        open={newTaskOpen}
        projects={projects}
        defaultProjectId={projectId}
        onSuccess={() => {
          setNewTaskOpen(false);
          router.refresh();
        }}
        onCancel={() => setNewTaskOpen(false)}
      />
    </>
  );
}
