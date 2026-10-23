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
import { Button, Select, message } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

import { DueText } from "@/components/ui/DueText";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type { TeamRole } from "@/features/teams/permissions";

import { updateTeamTaskAction } from "../actions";
import { canEditTask } from "../permissions";
import type { TeamTaskRow } from "../service";
import { NewTeamTaskModal } from "./NewTeamTaskModal";
import {
  TEAM_TASK_STATUS_LABEL,
  TEAM_TASK_STATUS_ORDER,
  firstActionError,
} from "./TeamTaskRowActions";

/** 看板视图入参（与列表同源，另加权限与团队上下文）。 */
export interface TeamKanbanProps {
  teamId: string;
  teamSlug: string;
  tasks: TeamTaskRow[];
  members: { id: string; name: string }[];
  today: string;
  projectId: string;
  projects: { id: string; name: string }[];
  role: TeamRole;
  actorId: string;
  projectSlug: string;
}

/** 状态筛选值：全部 + 三种状态。 */
type StatusFilter = "all" | TaskStatus;

/** 责任人筛选值：`all` / `unassigned` / 具体成员 ID。 */
type AssigneeFilter = string;

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
 * 窄屏下关闭拖拽，卡片主体把触摸滚动交还浏览器；
 * 状态流转改由列内按钮完成（与个人看板同一策略）。
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getDesktopServerSnapshot,
  );
}

/** 看板移动端（<861px）的状态切换按钮：无编辑权时整组禁用。 */
function TeamTaskStatusButtons({
  teamId,
  task,
  editable,
  onChanged,
}: {
  teamId: string;
  task: TeamTaskRow;
  editable: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<TaskStatus | null>(null);

  async function change(status: TaskStatus) {
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

  return (
    <div className="flex flex-wrap gap-1.5">
      {TEAM_TASK_STATUS_ORDER.map((status) => {
        const current = status === task.status;

        return (
          <Button
            key={status}
            size="small"
            type={current ? "primary" : "default"}
            disabled={!editable || current || pending !== null}
            loading={pending === status}
            onClick={() => {
              void change(status);
            }}
          >
            {TEAM_TASK_STATUS_LABEL[status]}
          </Button>
        );
      })}
    </div>
  );
}

/** 可拖拽的任务卡片（仅本人可编辑的任务启用拖拽）。 */
function TeamKanbanCard({
  teamId,
  task,
  today,
  assigneeName,
  draggable,
  onChanged,
}: {
  teamId: string;
  task: TeamTaskRow;
  today: string;
  assigneeName: string | null;
  draggable: boolean;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, disabled: !draggable });

  const done = task.status === "done";
  const hasSubtasks = task.subtasks.length > 0;
  const progress = getTaskProgress({
    status: task.status,
    subtasks: task.subtasks,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-xl border border-[#e1e3e6] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(14,19,24,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(14,19,24,0.08)] ${
        isDragging ? "opacity-50" : ""
      } ${done ? "opacity-[0.62]" : ""}`}
    >
      {/* 拖拽把手只覆盖卡片主体；窄屏不挂监听，保住 touch 滚动。 */}
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

        <div className="mt-2.5 flex items-center gap-2">
          {assigneeName ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#5f6368]">
              <UserAvatar username={assigneeName} size={22} />
              <span className="truncate">{assigneeName}</span>
            </span>
          ) : (
            <span className="text-[12.5px] text-[#9aa0a6]">未指派</span>
          )}

          <span className="ml-auto">
            {task.dueDate ? (
              <DueText
                dueDate={task.dueDate}
                status={task.status}
                today={today}
              />
            ) : (
              <span className="text-[12.5px] text-[#9aa0a6]">—</span>
            )}
          </span>
        </div>
      </div>

      <div className="mt-2.5 min-[861px]:hidden">
        <TeamTaskStatusButtons
          teamId={teamId}
          task={task}
          editable={draggable}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

/** 看板单列（同时是拖放目标）。 */
function TeamKanbanColumn({
  teamId,
  status,
  tasks,
  today,
  assigneeNames,
  canDragTask,
  onNewTask,
  onChanged,
}: {
  teamId: string;
  status: TaskStatus;
  tasks: TeamTaskRow[];
  today: string;
  assigneeNames: Map<string, string>;
  canDragTask: (task: TeamTaskRow) => boolean;
  onNewTask: () => void;
  onChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={TEAM_TASK_STATUS_LABEL[status]}
      className={`min-w-0 rounded-2xl p-3 transition-colors ${
        isOver
          ? "bg-[#eef0fc] outline outline-2 outline-dashed outline-offset-[-4px] outline-[#7d2ae8]"
          : "bg-[#f4f5f7]"
      }`}
    >
      <header className="flex items-center gap-2 px-2 pb-3 pt-1">
        <span className="text-[13.5px] font-bold text-[#0e1318]">
          {TEAM_TASK_STATUS_LABEL[status]}
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
            <TeamKanbanCard
              key={task.id}
              teamId={teamId}
              task={task}
              today={today}
              assigneeName={
                task.assigneeId
                  ? (assigneeNames.get(task.assigneeId) ?? null)
                  : null
              }
              draggable={canDragTask(task)}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * 团队项目看板（对照 `project-board.html`）。
 *
 * 三列「未开始 / 进行中 / 已完成」；拖卡落列即乐观更新状态，失败回滚并
 * `message.error`。只有 `canEditTask` 为 true 的卡片可拖（owner/admin 全部，
 * member 仅本人任务）；窄屏关闭拖拽、改由列内状态按钮完成流转。
 */
export function TeamKanban({
  teamId,
  tasks,
  members,
  today,
  projectId,
  projects,
  role,
  actorId,
}: TeamKanbanProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [items, setItems] = useState<TeamTaskRow[]>(tasks);
  const [syncedTasks, setSyncedTasks] = useState<TeamTaskRow[]>(tasks);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // 服务端刷新后以最新 props 为准（渲染期同步，避免 effect 多跑一轮）。
  if (tasks !== syncedTasks) {
    setSyncedTasks(tasks);
    setItems(tasks);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const assigneeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.id, member.name);
    return map;
  }, [members]);

  const filtered = useMemo(
    () =>
      items.filter((task) => {
        if (statusFilter !== "all" && task.status !== statusFilter) return false;
        if (assigneeFilter === "unassigned") return task.assigneeId === null;
        if (assigneeFilter !== "all") return task.assigneeId === assigneeFilter;
        return true;
      }),
    [items, statusFilter, assigneeFilter],
  );

  const grouped = useMemo(() => {
    const result: Record<TaskStatus, TeamTaskRow[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };

    for (const task of filtered) {
      result[task.status].push(task);
    }

    return result;
  }, [filtered]);

  function canDragTask(task: TeamTaskRow): boolean {
    if (!isDesktop) return false;
    return canEditTask({ role, actorId, assigneeId: task.assigneeId });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const nextStatus = String(over.id) as TaskStatus;
    if (!TEAM_TASK_STATUS_ORDER.includes(nextStatus)) return;

    const task = items.find((item) => item.id === taskId);
    if (!task || task.status === nextStatus) return;

    // 拖拽目标必须是本人可编辑的任务（防御性再判一次）。
    if (!canEditTask({ role, actorId, assigneeId: task.assigneeId })) return;

    const previousStatus = task.status;
    setItems((current) =>
      current.map((item) =>
        item.id === taskId ? { ...item, status: nextStatus } : item,
      ),
    );

    try {
      const result = await updateTeamTaskAction(taskId, {
        teamId,
        status: nextStatus,
      });

      if (!result.ok) {
        setItems((current) =>
          current.map((item) =>
            item.id === taskId ? { ...item, status: previousStatus } : item,
          ),
        );
        message.error(firstActionError(result.errors));
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

  const assigneeOptions = [
    { value: "all" as AssigneeFilter, label: "责任人：全部" },
    ...members.map((member) => ({
      value: member.id as AssigneeFilter,
      label: member.name,
    })),
    { value: "unassigned" as AssigneeFilter, label: "未指派" },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select<StatusFilter>
          size="small"
          aria-label="按状态筛选"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "状态：全部" },
            ...TEAM_TASK_STATUS_ORDER.map((status) => ({
              value: status,
              label: TEAM_TASK_STATUS_LABEL[status],
            })),
          ]}
          style={{ width: 120 }}
        />
        <Select<AssigneeFilter>
          size="small"
          aria-label="按责任人筛选"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={assigneeOptions}
          style={{ width: 130 }}
        />
        <span className="ml-auto text-[12.5px] text-[#9aa0a6]">
          共 {filtered.length} 条
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={(event) => {
          void handleDragEnd(event);
        }}
      >
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[861px]:grid-cols-3">
          {TEAM_TASK_STATUS_ORDER.map((status) => (
            <TeamKanbanColumn
              key={status}
              teamId={teamId}
              status={status}
              tasks={grouped[status]}
              today={today}
              assigneeNames={assigneeNames}
              canDragTask={canDragTask}
              onNewTask={() => setNewTaskOpen(true)}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      </DndContext>

      <NewTeamTaskModal
        open={newTaskOpen}
        teamId={teamId}
        projects={projects}
        defaultProjectId={projectId}
        members={members}
        defaultAssigneeId={actorId}
        onSuccess={() => {
          setNewTaskOpen(false);
          router.refresh();
        }}
        onCancel={() => setNewTaskOpen(false)}
      />
    </>
  );
}
