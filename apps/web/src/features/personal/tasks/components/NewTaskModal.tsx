"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { applyActionErrors } from "@/lib/action-form";
import { TASK_PRIORITIES, type TaskPriority } from "@open-doing/types";
import { priorityLabelKey } from "@/components/ui/PriorityChip";

import { createPersonalTaskAction } from "../actions";
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
}: NewTaskModalProps) {
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
        priority: "medium",
        dueDate: dueDateDefault,
        startDate: "",
        description: "",
      });
      setFormError(null);
    }
  }, [open, reset, defaultProject, dueDateDefault]);

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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("newTaskTitle")}</DialogTitle>
        </DialogHeader>

        {formError ? (
          <Alert variant="destructive" role="alert" className="mb-4">
            {formError}
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} noValidate>
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="personal-task-title">{t("title")}</Label>
            <Input
              id="personal-task-title"
              type="text"
              data-testid="task-title-input"
              placeholder={t("titlePlaceholder")}
              maxLength={TASK_TITLE_MAX_LENGTH}
              autoFocus
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "personal-task-title-error" : undefined}
              disabled={submitting}
              {...register("title")}
            />
            {errors.title ? (
              <p id="personal-task-title-error" className="text-[12.5px] text-[var(--error)]">
                {errors.title.message}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label>{t("spaceProjectLabel")}</Label>
            <Select
              value={watch("projectId")}
              onValueChange={(value) => setValue("projectId", value)}
            >
              <SelectTrigger className="w-full" data-testid="task-project-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {t("personalProjectOption", { name: project.name })}
                  </SelectItem>
                ))}
                <SelectItem value={NO_PROJECT}>{t("personalLooseOption")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label>{t("priority")}</Label>
            <Select
              value={watch("priority")}
              onValueChange={(value) => setValue("priority", value)}
            >
              <SelectTrigger className="w-full" data-testid="task-priority-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {t(priorityLabelKey(candidate))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 开始 / 截止同行排布（两列）。 */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="personal-task-start-date">{t("startDateLabel")}</Label>
              <Input
                id="personal-task-start-date"
                type="date"
                data-testid="task-start-date-input"
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
              <Label htmlFor="personal-task-due-date">{t("dueDateLabel")}</Label>
              <Input
                id="personal-task-due-date"
                type="date"
                data-testid="task-due-date-input"
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
            <Label htmlFor="personal-task-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="personal-task-description"
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
