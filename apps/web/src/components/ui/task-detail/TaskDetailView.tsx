"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Subtask, TaskPriority, TaskStatus } from "@open-doing/types";
import {
  getTaskProgress,
  isDueSoon,
  isOverdue,
  TASK_PRIORITIES,
} from "@open-doing/types";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { PriorityChip, priorityLabelKey } from "@/components/ui/PriorityChip";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusTag } from "@/components/ui/StatusTag";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { CommentBox } from "@/features/personal/tasks/components/CommentBox";
import { SubtaskList } from "@/features/personal/tasks/components/SubtaskList";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "@/lib/task-fields";
import { formatTaskDate } from "@/lib/date-display";
import { spaceDashboardHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

import { assigneeCalloutKey, shouldShowAssigneeCallout } from "./callout";
import type { TaskDetailModel, TaskDetailViewProps } from "./types";

/** 状态展示顺序（与项目页 / 看板一致）。 */
const STATUS_ORDER: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** 状态 → `status` 命名空间文案 key。 */
const STATUS_LABEL_KEY: Record<TaskStatus, "notStarted" | "inProgress" | "completed"> = {
  todo: "notStarted",
  in_progress: "inProgress",
  done: "completed",
};

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
          ? { background: "var(--status-overdue-bg)", color: "var(--status-overdue)" }
          : { background: "var(--status-due-soon-bg)", color: "#a66b00" }
      }
    >
      {children}
    </span>
  );
}

/** 右列 meta 行：固定宽度的键 + 自适应值。 */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--border-default)] py-[11px] text-[13px] first:border-t-0">
      <span className="w-16 shrink-0 text-[var(--ink-500)]">{label}</span>
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

/**
 * 编辑任务弹窗：标题 / 描述 / 截止日期。
 *
 * 提交失败时由 `onAction.updateTask`（client 包装件）统一提示错误，
 * 本组件保持弹窗打开，不吞掉失败状态。RHF 状态挂在常驻包装件上，
 * Radix Dialog 在退出保持窗口（约 200ms）结束后卸载内容，打开时以 task
 * 的当前值重置表单（还原 antd `destroyOnHidden` + `resetFields` 语义）。
 */
function EditTaskModal({
  open,
  task,
  onSave,
  onCancel,
}: EditTaskModalProps) {
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(1, t("titleRequired"))
      .max(TASK_TITLE_MAX_LENGTH, t("titleTooLong", { max: TASK_TITLE_MAX_LENGTH })),
    description: z
      .string()
      .refine(
        (value) => value.trim().length <= TASK_DESCRIPTION_MAX_LENGTH,
        t("descriptionTooLong", { max: TASK_DESCRIPTION_MAX_LENGTH }),
      ),
    dueDate: z.string(),
    startDate: z.string(),
  });
  type EditTaskFormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditTaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: task.title,
      description: task.description ?? "",
      dueDate: task.dueDate ?? "",
      startDate: task.startDate ?? "",
    },
  });

  // 每次打开都以 task 的当前值重置（退出保持窗口（约 200ms）结束后内容才
  // 卸载，但 RHF 状态常驻）。
  useEffect(() => {
    if (open) {
      reset({
        title: task.title,
        description: task.description ?? "",
        dueDate: task.dueDate ?? "",
        startDate: task.startDate ?? "",
      });
    }
  }, [open, reset, task.title, task.description, task.dueDate, task.startDate]);

  const onSubmit = handleSubmit(async (values) => {
    // 成功分支会关闭弹窗，但内容在退出保持窗口（约 200ms）内仍可交互；
    // 期间按钮恢复可点/可回车提交，这里按 open 作幂等闸门避免重复保存。
    if (!open) return;
    setSubmitting(true);

    try {
      await onSave({
        title: values.title,
        description: values.description ?? "",
        dueDate: values.dueDate.trim() ? values.dueDate : null,
        startDate: values.startDate.trim() ? values.startDate : null,
      });
      onCancel();
    } catch {
      // 错误文案由 onAction 实现负责；保留弹窗，便于修正后重试。
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("editTask")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="edit-task-title">{t("title")}</Label>
            <Input
              id="edit-task-title"
              type="text"
              placeholder={t("titlePlaceholder")}
              maxLength={TASK_TITLE_MAX_LENGTH}
              autoFocus
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "edit-task-title-error" : undefined}
              disabled={submitting}
              {...register("title")}
            />
            {errors.title ? (
              <p id="edit-task-title-error" className="text-[12.5px] text-[var(--error)]">
                {errors.title.message}
              </p>
            ) : null}
          </div>

          {/* 开始 / 截止同行排布（两列）。 */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-task-start-date">{t("startDateLabel")}</Label>
              <Input
                id="edit-task-start-date"
                type="date"
                aria-invalid={errors.startDate ? true : undefined}
                disabled={submitting}
                {...register("startDate")}
              />
              {errors.startDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.startDate.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-task-due-date">{t("dueDateLabel")}</Label>
              <Input
                id="edit-task-due-date"
                type="date"
                aria-invalid={errors.dueDate ? true : undefined}
                disabled={submitting}
                {...register("dueDate")}
              />
              {errors.dueDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.dueDate.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="edit-task-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="edit-task-description"
              rows={4}
              placeholder={t("descriptionPlaceholder")}
              disabled={submitting}
              {...register("description")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="task-edit-save">
              {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  backHref = spaceDashboardHref("personal"),
  backLabel,
  currentUserId,
  assigneeOptions,
  onAssign,
}: TaskDetailViewProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tStatus = useTranslations("status");
  const tDate = useTranslations("date");
  const tCommon = useTranslations("common");
  const today = todayInShanghai();
  const resolvedBackLabel = backLabel ?? t("backToProject");

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

  // 优先级（spec D8）：乐观选中，失败回滚；服务端刷新后以 props 为准。
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [syncedPriority, setSyncedPriority] = useState<TaskPriority>(task.priority);
  if (task.priority !== syncedPriority) {
    setSyncedPriority(task.priority);
    setPriority(task.priority);
  }
  const [priorityPending, setPriorityPending] = useState(false);

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

  async function changePriority(next: TaskPriority) {
    if (priorityPending || next === priority) return;

    const previous = priority;
    setPriorityPending(true);
    setPriority(next);

    try {
      await onAction.updateTask({ priority: next });
    } catch {
      // 失败提示由 onAction 实现负责；回滚乐观状态。
      setPriority(previous);
    } finally {
      setPriorityPending(false);
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

  const nextStatus: TaskStatus = status === "done" ? "todo" : "done";

  // 改派选项：未指派是占位，不是可选项；成员离职后任务保留未指派状态，
  // 但改派只能指向团队内成员（控制器裁决 5）。
  const assigneeChoices = assigneeOptions
    ? [
        ...assigneeOptions,
        ...(assigneeId && !assigneeOptions.some((option) => option.id === assigneeId)
          ? [
              {
                id: assigneeId,
                name: task.assigneeName ?? t("leftMember"),
              },
            ]
          : []),
      ]
    : [];

  // 负责人邮箱（规格 §1「负责人信息处展示邮箱」）：改派后优先取目标选项的
  // 邮箱，未改派时回退读模型；未填写邮箱不渲染。
  const assigneeEmail = !assigneeId
    ? null
    : assigneeId === task.assigneeId
      ? task.assigneeEmail ?? null
      : assigneeChoices.find((option) => option.id === assigneeId)?.email ?? null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <Link
        href={backHref}
        className="mb-4 inline-block text-[13px] text-[var(--ink-500)] no-underline hover:text-[var(--purple-600)] hover:underline"
      >
        {resolvedBackLabel}
      </Link>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 min-[1101px]:grid-cols-[minmax(0,1fr)_300px]">
        {/* 左列：任务主体 */}
        <div className="min-w-0">
          <h1 className="break-words text-[30px] font-bold leading-[1.2] tracking-[-0.01em] text-[var(--ink-900)]">
            {task.title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <StatusTag status={status} />

            {overdue ? (
              <DueTag tone="overdue">{tDate("overdue")}</DueTag>
            ) : dueSoon && task.dueDate ? (
              <DueTag tone="soon">
                {t("dueSoonFull", { date: formatTaskDate(task.dueDate) })}
              </DueTag>
            ) : null}
          </div>

          {task.description?.trim() ? (
            <p className="mt-4 whitespace-pre-wrap break-words text-[14px] leading-[1.65] text-[#3c4043]">
              {task.description}
            </p>
          ) : (
            <p className="mt-4 text-[14px] leading-[1.65] text-[var(--ink-400)]">
              {t("noDescription")}
            </p>
          )}

          <div className="mb-4 mt-6">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px] text-[var(--ink-500)]">
              <span>
                {hasSubtasks
                  ? t("progressWithSubtasks", { completed, total })
                  : t("progress")}
              </span>
              <span
                className={
                  hasSubtasks ? "font-semibold text-[var(--ink-900)]" : undefined
                }
              >
                {hasSubtasks
                  ? `${percent}%`
                  : t("noSubtasksProgress", { percent })}
              </span>
            </div>
            <ProgressBar value={progress} />
          </div>

          <h2 data-testid="subtask-heading" className="mb-3 mt-8 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--ink-500)]">
            {t("subtasksProgress", { completed, total })}
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

          <h2 className="mb-3 mt-8 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--ink-500)]">
            {t("commentsCount", { count: task.comments.length })}
          </h2>
          <CommentBox
            comments={task.comments}
            currentUserId={currentUserId ?? task.assigneeId ?? ""}
            onAdd={onAction.addComment}
            onDelete={onAction.deleteComment}
          />
        </div>

        {/* 右列：元信息 */}
        <aside className="min-w-0 rounded-xl border border-[var(--border-default)] bg-white p-5 shadow-[var(--shadow-rest)]">
          <div>
            <MetaRow label={t("statusLabel")}>
              <StatusTag status={status} />
              {/* 只读（团队态非责任人 / 非管理员）时不给状态切换入口：
                  服务层同样会拒绝，但界面不应先给出可点的假象。 */}
              {permissions.canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild disabled={statusPending !== null}>
                    <Button variant="ghost" size="sm" className="px-1">
                      {t("change")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {STATUS_ORDER.map((candidate) => (
                      <DropdownMenuItem
                        key={candidate}
                        disabled={candidate === status}
                        onClick={() => {
                          void changeStatus(candidate);
                        }}
                      >
                        {tStatus(STATUS_LABEL_KEY[candidate])}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </MetaRow>

            <MetaRow label={t("priority")}>
              {permissions.canEdit ? (
                <Select
                  value={priority}
                  onValueChange={(value) => {
                    void changePriority(value as TaskPriority);
                  }}
                  disabled={priorityPending}
                >
                  <SelectTrigger
                    className="h-8 w-[130px]"
                    aria-label={t("priority")}
                    data-testid="detail-priority-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((candidate) => (
                      <SelectItem
                        key={candidate}
                        value={candidate}
                        disabled={candidate === priority}
                      >
                        {t(priorityLabelKey(candidate))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <PriorityChip priority={priority} />
              )}
            </MetaRow>

            <MetaRow label={t("assigneeLabel")}>
              {space === "team" &&
              permissions.canAssign &&
              assigneeOptions &&
              onAssign ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Select
                    value={assigneeId ?? undefined}
                    onValueChange={(value) => {
                      void handleAssign(value);
                    }}
                    disabled={assigneePending}
                  >
                    <SelectTrigger
                      className="h-8 w-[170px]"
                      aria-label={t("assigneeLabel")}
                      data-testid="task-assignee-select"
                    >
                      <SelectValue placeholder={t("unassigned")} />
                    </SelectTrigger>
                    <SelectContent>
                      {assigneeChoices.map((option) => (
                        <SelectItem
                          key={option.id}
                          value={option.id}
                          disabled={option.id === assigneeId}
                        >
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {assigneeEmail ? (
                    <span className="break-all text-[12px] font-normal text-[var(--ink-400)]">
                      {assigneeEmail}
                    </span>
                  ) : null}
                </div>
              ) : task.assigneeName ? (
                <>
                  {/* Avatar color is keyed by user id; "" is a deterministic sentinel never seeded from the name. */}
                  <UserAvatar
                    userId={task.assigneeId ?? ""}
                    name={task.assigneeName}
                    size={24}
                  />
                  <div className="min-w-0">
                    <div className="break-words">{task.assigneeName}</div>
                    {assigneeEmail ? (
                      <div className="break-all text-[12px] font-normal text-[var(--ink-400)]">
                        {assigneeEmail}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <span className="font-normal text-[var(--ink-400)]">
                  {t("unassigned")}
                </span>
              )}
            </MetaRow>

            <MetaRow label={t("startDateLabel")}>
              {task.startDate ? (
                <span>{formatTaskDate(task.startDate)}</span>
              ) : (
                <span className="font-normal text-[var(--ink-400)]">—</span>
              )}
            </MetaRow>

            <MetaRow label={t("dueDateLabel")}>
              {task.dueDate ? (
                <>
                  <span>{formatTaskDate(task.dueDate)}</span>
                  {overdue ? (
                    <span className="font-semibold text-[var(--status-overdue)]">
                      {tDate("overdue")}
                    </span>
                  ) : null}
                  {dueSoon ? (
                    <DueTag tone="soon">{t("dueSoonTag")}</DueTag>
                  ) : null}
                </>
              ) : (
                <span className="font-normal text-[var(--ink-400)]">—</span>
              )}
            </MetaRow>

            <MetaRow label={t("projectLabel")}>
              {task.projectId && task.projectName ? (
                <Link
                  href={backHref}
                  className="min-w-0 truncate text-[var(--purple-600)] no-underline hover:underline"
                >
                  {task.projectName}
                </Link>
              ) : (
                <span className="font-normal text-[var(--ink-400)]">—</span>
              )}
            </MetaRow>

            {task.creatorName ? (
              <MetaRow label={t("creatorLabel")}>
                <span className="font-normal text-[var(--ink-500)]">
                  {t("createdAtLine", {
                    name: task.creatorName,
                    date: formatShanghaiDate(task.createdAt),
                  })}
                </span>
              </MetaRow>
            ) : null}
          </div>

          <div className="mt-4 border-t border-[var(--border-default)] pt-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px] text-[var(--ink-500)]">
              <span>{t("progress")}</span>
              <span>{percent}%</span>
            </div>
            <ProgressBar value={progress} />
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-400)]">
              {hasSubtasks
                ? t("progressHintWithSubtasks", { completed, total })
                : t("progressHintByStatus")}
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
                background: "var(--info-bg)",
                color: "#0b6fb8",
              }}
            >
              <span aria-hidden="true">ℹ</span>
              <span>{t(assigneeCalloutKey(permissions.canEdit))}</span>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            {permissions.canEdit ? (
              <Button className="w-full" onClick={() => setEditOpen(true)} data-testid="task-edit-open">
                {t("editTask")}
              </Button>
            ) : null}

            {permissions.canEdit ? (
              <Button
                variant="outline"
                className="w-full"
                data-testid="task-status-toggle"
                disabled={statusPending !== null}
                onClick={() => {
                  void changeStatus(nextStatus);
                }}
              >
                {statusPending === nextStatus ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : null}
                {status === "done" ? t("markNotDone") : t("markDone")}
              </Button>
            ) : null}

            {permissions.canDelete ? (
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-[var(--error-bg)] hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                {t("deleteTask")}
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
        title={t("deleteTask")}
        content={t("deleteConfirm", { title: task.title })}
        confirmText={tCommon("delete")}
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
