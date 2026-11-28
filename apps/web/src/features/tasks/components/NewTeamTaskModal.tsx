"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { DatePicker } from "@/components/ui/date-picker";
import { TASK_PRIORITIES, type Tag, type TaskPriority } from "@open-doing/types";
import { CheckIcon, DiamondIcon, FlagIcon, FolderIcon, Loader2Icon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
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
import { Textarea } from "@/components/ui/shadcn/textarea";
import { priorityLabelKey } from "@/components/ui/PriorityChip";
import { applyActionErrors } from "@/lib/action-form";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "@/lib/task-fields";

import { AttrPill } from "@/features/projects/components/AttrPill";
import { listTeamProjectMilestonesAction } from "@/features/projects/actions";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { createTeamTaskAction } from "../actions";
import { TaskTagPicker } from "@/features/tags/components/TaskTagPicker";

/** 新建团队任务弹窗入参。 */
export interface NewTeamTaskModalProps {
  /** 是否显示。 */
  open: boolean;
  teamId: string;
  /** 可选的团队项目（**仅本团队**；不提供个人空间选项）。 */
  projects: { id: string; name: string }[];
  /** 默认选中的项目（当前项目页传当前项目 ID）。 */
  defaultProjectId?: string | null;
  /** 可指派的团队成员。 */
  members: { id: string; name: string }[];
  /** 默认责任人（通常为当前用户）。 */
  defaultAssigneeId?: string | null;
  /** 预填的截止日期（`YYYY-MM-DD`；日历格子「+」入口按所点日期预填）。 */
  defaultDueDate?: string | null;
  /** 创建成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
  /** 本团队标签池（RSC 注入，必传——缺省空池会渲染假空态；为空时选择器显示空态文案）。 */
  tagPool: Tag[];
}

/**
 * 新建团队任务弹窗。
 *
 * 对照 `project-list.html`「新建任务」弹窗：项目下拉只列本团队项目
 * （控制器裁决：不提供个人空间选项），责任人下拉为团队成员、默认自己。
 * RHF 状态挂在常驻包装件上，Radix Dialog 在退出保持窗口（约 200ms）结束后
 * 卸载内容，打开时重置表单以还原 antd `resetFields` 语义。
 */
export function NewTeamTaskModal({
  open,
  teamId,
  projects,
  defaultProjectId,
  members,
  defaultAssigneeId,
  defaultDueDate,
  onSuccess,
  onCancel,
  tagPool = [],
}: NewTeamTaskModalProps) {
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const defaultProject =
    defaultProjectId &&
    projects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : (projects[0]?.id ?? "");

  const defaultAssignee =
    defaultAssigneeId &&
    members.some((member) => member.id === defaultAssigneeId)
      ? defaultAssigneeId
      : (members[0]?.id ?? "");

  const dueDateDefault = defaultDueDate ?? "";

  // zod schema 在组件内构建：必填文案取自 next-intl。
  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(1, t("titleRequired"))
      .max(TASK_TITLE_MAX_LENGTH, t("titleTooLong", { max: TASK_TITLE_MAX_LENGTH })),
    projectId: z.string().min(1, t("projectRequired")),
    milestoneId: z.string(),
    assigneeId: z.string(),
    priority: z.string(),
    dueDate: z.string(),
    startDate: z.string(),
    description: z
      .string()
      .refine(
        (value) => value.trim().length <= TASK_DESCRIPTION_MAX_LENGTH,
        t("descriptionTooLong", { max: TASK_DESCRIPTION_MAX_LENGTH }),
      ),
  });
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      projectId: defaultProject,
      milestoneId: "",
      assigneeId: defaultAssignee,
      priority: "medium",
      dueDate: dueDateDefault,
      startDate: "",
      description: "",
    },
  });

  // 每次打开都重置为初始值（关闭期间内容被卸载，但 RHF 状态常驻）。
  useEffect(() => {
    if (open) {
      reset({
        title: "",
        projectId: defaultProject,
        milestoneId: "",
        assigneeId: defaultAssignee,
        priority: "medium",
        dueDate: dueDateDefault,
        startDate: "",
        description: "",
      });
      setFormError(null);
      setTagIds([]);
    }
  }, [open, reset, defaultProject, defaultAssignee, dueDateDefault]);

  // 所选项目的里程碑选项（弹窗打开且选定项目后拉取）
  const watchProjectId = watch("projectId");
  const watchMilestoneId = watch("milestoneId");
  const [milestoneOptions, setMilestoneOptions] = useState<
    { id: string; name: string; dueDate?: string }[]
  >([]);
  useEffect(() => {
    if (!open || !watchProjectId) {
      setMilestoneOptions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listTeamProjectMilestonesAction({ teamId, projectId: watchProjectId }).then(
        (result: Awaited<ReturnType<typeof listTeamProjectMilestonesAction>>) => {
          if (!cancelled && result.ok) setMilestoneOptions(result.data);
        },
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, watchProjectId, teamId]);
  const descriptionValue = watch("description");

  const onSubmit = handleSubmit(async (values) => {
    // 成功分支会关闭弹窗，但内容在退出保持窗口（约 200ms）内仍可交互；
    // 期间按钮恢复可点/可回车提交，这里按 open 作幂等闸门避免重复创建。
    if (!open) return;
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createTeamTaskAction({
        teamId,
        projectId: values.projectId,
        title: values.title,
        description: values.description ?? "",
        priority: values.priority as TaskPriority,
        dueDate: values.dueDate.trim() ? values.dueDate : null,
        startDate: values.startDate.trim() ? values.startDate : null,
        assigneeId: values.assigneeId || null,
        milestoneId: values.milestoneId.trim() ? values.milestoneId : null,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof FormValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      toast.success(t("taskCreated"));
      onSuccess();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="flex h-[min(90dvh,880px)] w-full flex-col gap-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{t("newTaskTitle")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
          {formError ? (
            <Alert variant="destructive" role="alert" className="mb-4">
              {formError}
            </Alert>
          ) : null}

          {/* 大标题内联输入（ProjectForm 同款：占位即标签）。 */}
          <Input
            type="text"
            data-testid="task-title-input"
            placeholder={t("titlePlaceholder")}
            maxLength={TASK_TITLE_MAX_LENGTH}
            autoFocus
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? "team-task-title-error" : undefined}
            disabled={submitting}
            className="h-auto border-none bg-transparent px-0 text-[22px] font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
            {...register("title")}
          />
          {errors.title ? (
            <p id="team-task-title-error" className="mb-2 text-[12.5px] text-[var(--error)]">
              {errors.title.message}
            </p>
          ) : null}

          {/* 属性胶囊行（ProjectForm 同款）；日期保留 DatePicker 行——e2e .fill 契约。 */}
          <div className="my-3 flex flex-wrap items-center gap-2">
            <AttrPill
              testid="task-project-select"
              icon={<FolderIcon className="size-3.5" aria-hidden="true" />}
              label={t("projectLabel")}
              value={projects.find((project) => project.id === watch("projectId"))?.name}
              disabled={submitting}
            >
              {(close) => (
                <div className="flex flex-col">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      data-testid={`task-project-option-${project.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                      onClick={() => {
                        setValue("projectId", project.id);
                        close();
                      }}
                    >
                      <FolderIcon className="size-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                      <span className="flex-1">{project.name}</span>
                      {watch("projectId") === project.id ? (
                        <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </AttrPill>

            <AttrPill
              testid="task-assignee-select"
              icon={<UserIcon className="size-3.5" aria-hidden="true" />}
              label={t("assigneeLabel")}
              value={(() => {
                const current = members.find((member) => member.id === watch("assigneeId"));
                if (!current) return t("unassigned");
                return current.id === defaultAssigneeId
                  ? t("memberSelf", { name: current.name })
                  : current.name;
              })()}
              disabled={submitting}
            >
              {(close) => (
                <div className="flex flex-col">
                  {members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      data-testid={`task-assignee-option-${member.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                      onClick={() => {
                        setValue("assigneeId", member.id);
                        close();
                      }}
                    >
                      <UserAvatar userId={member.id} name={member.name} size={22} />
                      <span className="flex-1">
                        {member.id === defaultAssigneeId
                          ? t("memberSelf", { name: member.name })
                          : member.name}
                      </span>
                      {watch("assigneeId") === member.id ? (
                        <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </AttrPill>

            <AttrPill
              testid="task-priority-select"
              icon={<FlagIcon className="size-3.5" aria-hidden="true" />}
              label={t("priority")}
              value={t(priorityLabelKey(watch("priority") as TaskPriority))}
              valueActive
              disabled={submitting}
            >
              {(close) => (
                <div className="flex flex-col">
                  {TASK_PRIORITIES.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      data-testid={`task-priority-option-${candidate}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                      onClick={() => {
                        setValue("priority", candidate);
                        close();
                      }}
                    >
                      <FlagIcon className="size-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                      {t(priorityLabelKey(candidate))}
                    </button>
                  ))}
                </div>
              )}
            </AttrPill>

            <AttrPill
              testid="task-milestone-select"
              icon={<DiamondIcon className="size-3.5" aria-hidden="true" />}
              label={t("milestoneLabel")}
              value={
                milestoneOptions.find((milestone) => milestone.id === watchMilestoneId)?.name ??
                t("milestoneNone")
              }
              disabled={submitting}
            >
              {(close) => (
                <div className="flex flex-col">
                  <button
                    type="button"
                    data-testid="task-milestone-option-none"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      setValue("milestoneId", "");
                      close();
                    }}
                  >
                    <DiamondIcon className="size-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                    {t("milestoneNone")}
                  </button>
                  {milestoneOptions.map((milestone) => (
                    <button
                      key={milestone.id}
                      type="button"
                      data-testid={`task-milestone-option-${milestone.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                      onClick={() => {
                        setValue("milestoneId", milestone.id);
                        close();
                      }}
                    >
                      <DiamondIcon className="size-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                      <span className="flex-1">{milestone.name}</span>
                      {watchMilestoneId === milestone.id ? (
                        <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </AttrPill>

            {/* 空池也渲染：TaskTagPicker 自带 tags.emptyPool 空态（入口常显）。 */}
            <TaskTagPicker
              space={{ kind: "team", teamId }}
              pool={tagPool}
              value={tagIds}
              onChange={setTagIds}
              canEdit={!submitting}
            />
          </div>

          {errors.projectId ? (
            <p className="text-[12.5px] text-[var(--error)]">{errors.projectId.message}</p>
          ) : null}
          <p className="text-[12.5px] text-[var(--ink-400)]">{t("assigneeHelp")}</p>

          {/* 开始 / 截止同行排布（DatePicker 保留：e2e .fill 契约）。 */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-task-start-date">{t("startDateLabel")}</Label>
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <DatePicker
                    id="team-task-start-date"
                    testid="task-start-date-input"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={submitting}
                    invalid={errors.startDate ? true : undefined}
                  />
                )}
              />
              {errors.startDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.startDate.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="team-task-due-date">{t("dueDateLabel")}</Label>
              <Controller
                control={control}
                name="dueDate"
                render={({ field }) => (
                  <DatePicker
                    id="team-task-due-date"
                    testid="task-due-date-input"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={submitting}
                    invalid={errors.dueDate ? true : undefined}
                  />
                )}
              />
              {errors.dueDate ? (
                <p className="text-[12.5px] text-[var(--error)]">
                  {errors.dueDate.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="my-3 border-t border-[var(--border)]" />

          {/* 描述区（ProjectForm 同款弹性大区）。 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <Textarea
              id="team-task-description"
              placeholder={t("descriptionPlaceholder")}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={
                errors.description ? "team-task-description-error" : undefined
              }
              disabled={submitting}
              className="min-h-[120px] flex-1 resize-none border-none bg-transparent px-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              {...register("description")}
            />
            <CharCounter value={descriptionValue} max={TASK_DESCRIPTION_MAX_LENGTH} />
          </div>
          {errors.description ? (
            <p
              id="team-task-description-error"
              className="text-[12.5px] text-[var(--error)]"
            >
              {errors.description.message}
            </p>
          ) : null}

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} data-testid="task-create-submit-button">
              {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {t("okCreateTask")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
