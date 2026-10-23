"use client";

import type { Subtask, TaskStatus } from "@open-doing/types";
import {
  getTaskProgress,
  isDueSoon,
  isOverdue,
} from "@open-doing/types";
import {
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  type MenuProps,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { CommentBox } from "@/features/personal/tasks/components/CommentBox";
import { SubtaskList } from "@/features/personal/tasks/components/SubtaskList";
import { todayInShanghai } from "@/lib/today";

import { assigneeCalloutText, shouldShowAssigneeCallout } from "./callout";
import type { TaskDetailModel, TaskDetailViewProps } from "./types";

/** 状态展示顺序（与项目页 / 看板一致）。 */
const STATUS_ORDER: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** 状态中文文案。 */
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "未开始",
  in_progress: "进行中",
  done: "已完成",
};

/** 将 `YYYY-MM-DD` 显示为 `MM-DD`。 */
function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

/**
 * ISO 时间戳 -> Asia/Shanghai 时区的 `YYYY-MM-DD`。
 *
 * 与评论时间一样显式指定时区，避免服务端 / 客户端本地时区不同导致
 * 水合文本不一致。
 */
function formatShanghaiDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 临期 / 逾期小标签（颜色取自设计令牌的语义色）。 */
function DueTag({
  tone,
  children,
}: {
  tone: "soon" | "overdue";
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-[1.5]"
      style={
        tone === "overdue"
          ? { background: "rgba(255, 87, 87, 0.1)", color: "#ff5757" }
          : { background: "rgba(255, 176, 32, 0.12)", color: "#a66b00" }
      }
    >
      {children}
    </span>
  );
}

/** 右列 meta 行：固定宽度的键 + 自适应值。 */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-[#e1e3e6] py-[11px] text-[13px] first:border-t-0">
      <span className="w-16 shrink-0 text-[#5f6368]">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
        {children}
      </span>
    </div>
  );
}

interface EditTaskModalProps {
  open: boolean;
  task: TaskDetailModel;
  onSave: TaskDetailViewProps["onAction"]["updateTask"];
  onCancel: () => void;
}

interface EditTaskFormValues {
  title: string;
  description?: string;
  dueDate?: string;
}

/**
 * 编辑任务弹窗：标题 / 描述 / 截止日期。
 *
 * 提交失败时由 `onAction.updateTask`（client 包装件）统一提示错误，
 * 本组件保持弹窗打开，不吞掉失败状态。
 */
function EditTaskModal({
  open,
  task,
  onSave,
  onCancel,
}: EditTaskModalProps) {
  const [form] = Form.useForm<EditTaskFormValues>();
  const [submitting, setSubmitting] = useState(false);

  async function handleFinish(values: EditTaskFormValues) {
    setSubmitting(true);

    try {
      await onSave({
        title: values.title,
        description: values.description ?? "",
        dueDate: values.dueDate?.trim() ? values.dueDate : null,
      });
      onCancel();
    } catch {
      // 错误文案由 onAction 实现负责；保留弹窗，便于修正后重试。
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="编辑任务"
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => form.submit()}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={submitting}
        initialValues={{
          title: task.title,
          description: task.description ?? "",
          dueDate: task.dueDate ?? "",
        }}
        onFinish={handleFinish}
      >
        <Form.Item
          label="标题"
          name="title"
          rules={[
            { required: true, whitespace: true, message: "请输入任务标题" },
            { max: 200, message: "任务标题不能超过 200 个字符" },
          ]}
        >
          <Input placeholder="任务要做什么？" maxLength={200} autoFocus />
        </Form.Item>

        <Form.Item label="截止日期" name="dueDate">
          <Input type="date" style={{ maxWidth: 220 }} />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea rows={4} placeholder="补充背景、验收标准…" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * 任务详情共享件（P-4 创建，J-5 原样复用）。
 *
 * 两栏布局对照 `docs/prototypes/task-detail.html`；个人态文案适配：
 * - 隐藏团队语境的 info callout 与「全员可评论」后缀；
 * - 个人态责任人只展示本人，不提供选择器；团队态在可改派时渲染选择器
 *   （J-5 加法扩展，见 `assigneeOptions` / `onAssign`）；
 * - 无子任务时进度按任务状态计算。
 *
 * 所有交互都通过 `onAction` 回调上抛，本组件不直接依赖 Server Actions。
 */
export function TaskDetailView({
  task,
  space,
  permissions,
  onAction,
  backHref = "/my",
  currentUserId,
  assigneeOptions,
  onAssign,
}: TaskDetailViewProps) {
  const router = useRouter();
  const today = todayInShanghai();

  // 服务端刷新（router.refresh）后以最新 props 为准；渲染期同步 props →
  // state 是 React 推荐的「props 变化时调整 state」写法。
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [syncedStatus, setSyncedStatus] = useState<TaskStatus>(task.status);
  if (task.status !== syncedStatus) {
    setSyncedStatus(task.status);
    setStatus(task.status);
  }

  const [subtasks, setSubtasks] = useState<Subtask[]>(task.subtasks);
  const [syncedSubtasks, setSyncedSubtasks] = useState<Subtask[]>(
    task.subtasks,
  );
  if (task.subtasks !== syncedSubtasks) {
    setSyncedSubtasks(task.subtasks);
    setSubtasks(task.subtasks);
  }

  // 责任人选择器（J-5）：乐观选中，失败回滚；服务端刷新后以 props 为准。
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assigneeId);
  const [syncedAssigneeId, setSyncedAssigneeId] = useState<string | null>(
    task.assigneeId,
  );
  if (task.assigneeId !== syncedAssigneeId) {
    setSyncedAssigneeId(task.assigneeId);
    setAssigneeId(task.assigneeId);
  }
  const [assigneePending, setAssigneePending] = useState(false);

  const [statusPending, setStatusPending] = useState<TaskStatus | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const progress = getTaskProgress({ status, subtasks });
  const percent = Math.round(progress * 100);
  const total = subtasks.length;
  const completed = subtasks.filter((subtask) => subtask.completed).length;
  const hasSubtasks = total > 0;

  const dueSoon = task.dueDate
    ? isDueSoon(task.dueDate, status, today)
    : false;
  const overdue = task.dueDate ? isOverdue(task.dueDate, status, today) : false;

  async function changeStatus(nextStatus: TaskStatus) {
    if (statusPending || nextStatus === status) return;

    const previous = status;
    setStatusPending(nextStatus);
    setStatus(nextStatus);

    try {
      await onAction.updateStatus(nextStatus);
    } catch {
      // 失败提示由 onAction 实现负责；回滚乐观状态。
      setStatus(previous);
    } finally {
      setStatusPending(null);
    }
  }

  async function handleToggleSubtask(
    subtaskId: string,
    completedNext: boolean,
  ) {
    const previous = subtasks;
    setSubtasks((current) =>
      current.map((subtask) =>
        subtask.id === subtaskId
          ? { ...subtask, completed: completedNext }
          : subtask,
      ),
    );

    try {
      await onAction.toggleSubtask(subtaskId, completedNext);
    } catch {
      setSubtasks(previous);
    }
  }

  async function handleAddSubtask(title: string) {
    if (!onAction.addSubtask) return;
    await onAction.addSubtask(title);
  }

  async function handleRemoveSubtask(subtaskId: string) {
    if (!onAction.removeSubtask) return;

    const previous = subtasks;
    setSubtasks((current) =>
      current.filter((subtask) => subtask.id !== subtaskId),
    );

    try {
      await onAction.removeSubtask(subtaskId);
    } catch {
      setSubtasks(previous);
    }
  }

  async function handleAssign(nextAssigneeId: string) {
    if (!onAssign || nextAssigneeId === assigneeId) return;

    const previous = assigneeId;
    setAssigneeId(nextAssigneeId);
    setAssigneePending(true);

    try {
      await onAssign(nextAssigneeId);
    } catch {
      // 失败提示由 onAssign 实现负责；回滚选中值。
      setAssigneeId(previous);
    } finally {
      setAssigneePending(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);

    try {
      await onAction.deleteTask();
      setDeleteOpen(false);
      router.push(backHref);
    } catch {
      // 失败提示由 onAction 实现负责；停留在当前页。
    } finally {
      setDeleting(false);
    }
  }

  const statusMenuItems: MenuProps["items"] = STATUS_ORDER.map(
    (candidate) => ({
      key: candidate,
      label: STATUS_LABEL[candidate],
      disabled: candidate === status,
    }),
  );

  const nextStatus: TaskStatus = status === "done" ? "todo" : "done";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <Link
        href={backHref}
        className="mb-4 inline-block text-[13px] text-[#5f6368] no-underline hover:text-[#7d2ae8] hover:underline"
      >
        ← 返回项目
      </Link>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 min-[1101px]:grid-cols-[minmax(0,1fr)_300px]">
        {/* 左列：任务主体 */}
        <div className="min-w-0">
          <h1 className="break-words text-[30px] font-bold leading-[1.2] tracking-[-0.01em] text-[#0e1318]">
            {task.title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <StatusTag status={status} />

            {overdue ? (
              <DueTag tone="overdue">已逾期</DueTag>
            ) : dueSoon && task.dueDate ? (
              <DueTag tone="soon">
                {task.dueDate === today ? "今天" : "明天"}{" "}
                {shortDate(task.dueDate)} 到期
              </DueTag>
            ) : null}
          </div>

          {task.description?.trim() ? (
            <p className="mt-4 whitespace-pre-wrap break-words text-[14px] leading-[1.65] text-[#3c4043]">
              {task.description}
            </p>
          ) : (
            <p className="mt-4 text-[14px] leading-[1.65] text-[#9aa0a6]">
              暂无描述
            </p>
          )}

          <div className="mb-4 mt-6">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px] text-[#5f6368]">
              <span>
                {hasSubtasks
                  ? `任务进度 · ${completed}/${total} 个子任务`
                  : "任务进度"}
              </span>
              <span
                className={
                  hasSubtasks ? "font-semibold text-[#0e1318]" : undefined
                }
              >
                {hasSubtasks
                  ? `${percent}%`
                  : `无子任务，按状态计 ${percent}%`}
              </span>
            </div>
            <ProgressBar value={progress} />
          </div>

          <h2 className="mb-3 mt-8 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.04em] text-[#5f6368]">
            子任务 · {completed}/{total}
          </h2>
          {/* 子任务与状态同属编辑权：只读态下复选框禁用、增删入口隐藏。 */}
          <SubtaskList
            subtasks={subtasks}
            onToggle={permissions.canEdit ? handleToggleSubtask : undefined}
            onAdd={
              permissions.canEdit && onAction.addSubtask
                ? handleAddSubtask
                : undefined
            }
            onRemove={
              permissions.canEdit && onAction.removeSubtask
                ? handleRemoveSubtask
                : undefined
            }
          />

          <h2 className="mb-3 mt-8 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.04em] text-[#5f6368]">
            评论 · {task.comments.length}
          </h2>
          <CommentBox
            comments={task.comments}
            currentUserId={currentUserId ?? task.assigneeId ?? ""}
            onAdd={onAction.addComment}
            onDelete={onAction.deleteComment}
          />
        </div>

        {/* 右列：元信息 */}
        <aside className="min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
          <div>
            <MetaRow label="状态">
              <StatusTag status={status} />
              {/* 只读（团队态非责任人 / 非管理员）时不给状态切换入口：
                  服务层同样会拒绝，但界面不应先给出可点的假象。 */}
              {permissions.canEdit ? (
                <Dropdown
                  trigger={["click"]}
                  disabled={statusPending !== null}
                  menu={{
                    items: statusMenuItems,
                    onClick: ({ key }) => {
                      void changeStatus(key as TaskStatus);
                    },
                  }}
                >
                  <Button type="text" size="small" className="px-1">
                    更改
                  </Button>
                </Dropdown>
              ) : null}
            </MetaRow>

            <MetaRow label="责任人">
              {space === "team" &&
              permissions.canAssign &&
              assigneeOptions &&
              onAssign ? (
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  aria-label="责任人"
                  style={{ width: 170 }}
                  value={assigneeId ?? undefined}
                  placeholder="未指派"
                  loading={assigneePending}
                  disabled={assigneePending}
                  // 未指派是占位，不是可选项：成员离职后任务保留未指派状态，
                  // 但改派只能指向团队内成员（控制器裁决 5）。
                  options={[
                    ...assigneeOptions,
                    ...(assigneeId &&
                    !assigneeOptions.some((option) => option.id === assigneeId)
                      ? [
                          {
                            id: assigneeId,
                            name: task.assigneeName ?? "已离开成员",
                          },
                        ]
                      : []),
                  ].map((option) => ({
                    value: option.id,
                    label: option.name,
                    disabled: option.id === assigneeId,
                  }))}
                  onChange={(value) => {
                    void handleAssign(value);
                  }}
                />
              ) : task.assigneeName ? (
                <>
                  <UserAvatar username={task.assigneeName} size={24} />
                  <span className="min-w-0 break-words">
                    {task.assigneeName}
                  </span>
                </>
              ) : (
                <span className="font-normal text-[#9aa0a6]">未指派</span>
              )}
            </MetaRow>

            <MetaRow label="截止日期">
              {task.dueDate ? (
                <>
                  <span>{shortDate(task.dueDate)}</span>
                  {overdue ? (
                    <span className="font-semibold text-[#ff5757]">已逾期</span>
                  ) : dueSoon ? (
                    <span className="text-[#a66b00]">
                      {task.dueDate === today ? "今天" : "明天"}
                    </span>
                  ) : null}
                  {dueSoon ? <DueTag tone="soon">临期</DueTag> : null}
                </>
              ) : (
                <span className="font-normal text-[#9aa0a6]">—</span>
              )}
            </MetaRow>

            <MetaRow label="所属项目">
              {task.projectId && task.projectName ? (
                <Link
                  href={backHref}
                  className="min-w-0 truncate text-[#7d2ae8] no-underline hover:underline"
                >
                  {task.projectName}
                </Link>
              ) : (
                <span className="font-normal text-[#9aa0a6]">—</span>
              )}
            </MetaRow>

            {task.creatorName ? (
              <MetaRow label="创建人">
                <span className="font-normal text-[#5f6368]">
                  {task.creatorName} · {formatShanghaiDate(task.createdAt)} 创建
                </span>
              </MetaRow>
            ) : null}
          </div>

          <div className="mt-4 border-t border-[#e1e3e6] pt-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px] text-[#5f6368]">
              <span>任务进度</span>
              <span>{percent}%</span>
            </div>
            <ProgressBar value={progress} />
            <p className="mt-2 text-[12px] leading-relaxed text-[#9aa0a6]">
              {hasSubtasks
                ? `由 ${completed}/${total} 个子任务完成度自动计算`
                : "按任务状态自动计算"}
            </p>
          </div>

          {/* 团队态差异控件：个人态永不渲染原型里的团队语境 callout；
              文案以责任人视角写成，故按身份（assigneeId === currentUserId）
              判断——canAssign 表示「可以改派」，owner/admin 也拥有，用它判断
              会让非责任人看到「你是此任务的责任人」。责任人选择器留给 J-5。 */}
          {shouldShowAssigneeCallout({
            space,
            currentUserId,
            assigneeId: task.assigneeId,
            canEdit: permissions.canEdit,
          }) ? (
            <div
              className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] leading-relaxed"
              style={{
                background: "rgba(13, 153, 255, 0.1)",
                color: "#0b6fb8",
              }}
            >
              <span aria-hidden="true">ℹ</span>
              <span>{assigneeCalloutText(permissions.canEdit)}</span>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            {permissions.canEdit ? (
              <Button type="primary" block onClick={() => setEditOpen(true)}>
                编辑任务
              </Button>
            ) : null}

            {permissions.canEdit ? (
              <Button
                block
                loading={statusPending === nextStatus}
                disabled={statusPending !== null}
                onClick={() => {
                  void changeStatus(nextStatus);
                }}
              >
                {status === "done" ? "标记为未完成" : "标记为已完成"}
              </Button>
            ) : null}

            {permissions.canDelete ? (
              <Button danger block onClick={() => setDeleteOpen(true)}>
                删除任务
              </Button>
            ) : null}
          </div>
        </aside>
      </div>

      <EditTaskModal
        open={editOpen}
        task={task}
        onSave={onAction.updateTask}
        onCancel={() => setEditOpen(false)}
      />

      <ConfirmModal
        open={deleteOpen}
        title="删除任务"
        content={`删除后子任务与评论一并删除，且不可恢复。确定删除「${task.title}」吗？`}
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
