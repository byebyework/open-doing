"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { DatePill } from "@/components/ui/date-picker";
import { CheckIcon, DiamondIcon, FlagIcon, FolderIcon, Loader2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/shadcn/textarea";
import { applyActionErrors } from "@/lib/action-form";
import { TASK_PRIORITIES, type Tag, type TaskPriority } from "@open-doing/types";
import { priorityLabelKey } from "@/components/ui/PriorityChip";

import { AttrPill } from "@/features/projects/components/AttrPill";
import { listPersonalProjectMilestonesAction } from "@/features/personal/projects/actions";
import { createPersonalTaskAction } from "../actions";
import { TaskTagPicker } from "@/features/tags/components/TaskTagPicker";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "@/lib/task-fields";

/** 新建任务弹窗入参。 */
export interface NewTaskModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 可选的个人项目（「个人空间 / <项目名>」）。 */
  projects: { id: string; name: string }[];
  /** 默认选中的项目；缺省或不在列表中时选中「不属于项目」。 */
  defaultProjectId?: string | null;
  /** 预填的截止日期（`YYYY-MM-DD`；日历格子「+」入口按所点日期预填）。 */
  defaultDueDate?: string | null;
  /** 创建成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
  /** 本人标签池（RSC 注入，必传——缺省空池会渲染假空态；为空时选择器显示空态文案）。 */
  tagPool: Tag[];
}

/** 「不属于项目」在 Radix Select 里的哨兵值（不允许空字符串 item value）。 */
const NO_PROJECT = "__none__";

/**
 * 新建任务弹窗（个人空间）。
 *
 * 文案逐字对照 `personal-project.html`「新建任务」弹窗：无责任人字段，
 * 项目下拉 = 传入项目 + 末项「个人空间 · 不属于项目」。
 * RHF 状态挂在常驻包装件上，Radix Dialog 在退出保持窗口（约 200ms）结束后
 * 卸载内容，打开时重置表单以还原 antd `resetFields` 语义。
 */
export function NewTaskModal({
  open,
  projects,
  defaultProjectId,
  defaultDueDate,
  onSuccess,
  onCancel,
  tagPool = [],
}: NewTaskModalProps) {
  const t = useTranslations("tasks");
  const tTasks = t;
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const defaultProject =
    defaultProjectId &&
    projects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : NO_PROJECT;

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(1, t("titleRequired"))
      .max(TASK_TITLE_MAX_LENGTH, t("titleTooLong", { max: TASK_TITLE_MAX_LENGTH })),
    projectId: z.string(),
    milestoneId: z.string(),
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

  const dueDateDefault = defaultDueDate ?? "";

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
        priority: "medium",
        dueDate: dueDateDefault,
        startDate: "",
        description: "",
      });
      setFormError(null);
      setTagIds([]);
    }
  }, [open, reset, defaultProject, dueDateDefault]);

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
      void listPersonalProjectMilestonesAction(watchProjectId).then(
        (result: Awaited<ReturnType<typeof listPersonalProjectMilestonesAction>>) => {
          if (!cancelled && result.ok) setMilestoneOptions(result.data);
        },
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, watchProjectId]);
  const descriptionValue = watch("description");

  const onSubmit = handleSubmit(async (values) => {
    // 成功分支会关闭弹窗，但内容在退出保持窗口（约 200ms）内仍可交互；
    // 期间按钮恢复可点/可回车提交，这里按 open 作幂等闸门避免重复创建。
    if (!open) return;
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createPersonalTaskAction({
        title: values.title,
        description: values.description ?? "",
        priority: values.priority as TaskPriority,
        dueDate: values.dueDate.trim() ? values.dueDate : null,
        startDate: values.startDate.trim() ? values.startDate : null,
        projectId: values.projectId === NO_PROJECT ? null : values.projectId,
        milestoneId:
          values.projectId !== NO_PROJECT && values.milestoneId.trim() ? values.milestoneId : null,
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
            aria-describedby={errors.title ? "personal-task-title-error" : undefined}
            disabled={submitting}
            className="h-auto border-none bg-transparent px-0 text-[22px] font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
            {...register("title")}
          />
          {errors.title ? (
            <p id="personal-task-title-error" className="mb-2 text-[12.5px] text-[var(--error)]">
              {errors.title.message}
            </p>
          ) : null}

          <div className="my-3 flex flex-wrap items-center gap-2">
            <AttrPill
              testid="task-project-select"
              icon={<FolderIcon className="size-3.5" aria-hidden="true" />}
              label={t("spaceProjectLabel")}
              value={
                watch("projectId") === NO_PROJECT
                  ? t("personalLooseOption")
                  : t("personalProjectOption", {
                      name: projects.find((project) => project.id === watch("projectId"))?.name ?? "",
                    })
              }
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
                      <span className="flex-1">
                        {t("personalProjectOption", { name: project.name })}
                      </span>
                      {watch("projectId") === project.id ? (
                        <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid={`task-project-option-${NO_PROJECT}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
                    onClick={() => {
                      setValue("projectId", NO_PROJECT);
                      close();
                    }}
                  >
                    <FolderIcon className="size-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                    <span className="flex-1">{t("personalLooseOption")}</span>
                    {watch("projectId") === NO_PROJECT ? (
                      <CheckIcon className="size-3.5 text-[var(--color-text)]" aria-hidden="true" />
                    ) : null}
                  </button>
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
              label={tTasks("milestoneLabel")}
              value={
                milestoneOptions.find((milestone) => milestone.id === watchMilestoneId)?.name ??
                tTasks("milestoneNone")
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
                    {tTasks("milestoneNone")}
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
              space={{ kind: "personal" }}
              pool={tagPool}
              value={tagIds}
              onChange={setTagIds}
              canEdit={!submitting}
            />

            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <DatePill
                  id="personal-task-start-date"
                  testid="task-start-date-input"
                  label={t("startDateLabel")}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  disabled={submitting}
                  invalid={errors.startDate ? true : undefined}
                />
              )}
            />
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <DatePill
                  id="personal-task-due-date"
                  testid="task-due-date-input"
                  label={t("dueDateLabel")}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  disabled={submitting}
                  invalid={errors.dueDate ? true : undefined}
                />
              )}
            />
          </div>

          {errors.startDate ? (
            <p className="text-[12.5px] text-[var(--error)]">{errors.startDate.message}</p>
          ) : null}
          {errors.dueDate ? (
            <p className="text-[12.5px] text-[var(--error)]">{errors.dueDate.message}</p>
          ) : null}

          <div className="my-3 border-t border-[var(--border)]" />

          {/* 描述区（ProjectForm 同款弹性大区）。 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <Textarea
              id="personal-task-description"
              placeholder={t("descriptionPlaceholder")}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={
                errors.description ? "personal-task-description-error" : undefined
              }
              disabled={submitting}
              className="min-h-[120px] flex-1 resize-none border-none bg-transparent px-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              {...register("description")}
            />
            <CharCounter value={descriptionValue} max={TASK_DESCRIPTION_MAX_LENGTH} />
          </div>
          {errors.description ? (
            <p
              id="personal-task-description-error"
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
