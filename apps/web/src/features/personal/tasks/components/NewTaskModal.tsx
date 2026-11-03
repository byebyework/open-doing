"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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

import { createPersonalTaskAction } from "../actions";

/** 新建任务弹窗入参。 */
export interface NewTaskModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 可选的个人项目（「个人空间 / <项目名>」）。 */
  projects: { id: string; name: string }[];
  /** 默认选中的项目；缺省或不在列表中时选中「不属于项目」。 */
  defaultProjectId?: string | null;
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
 * Radix Dialog 关闭即卸载内容，每次打开按 props 重建 RHF 初始值。
 */
export function NewTaskModal({
  open,
  projects,
  defaultProjectId,
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
      .max(200, t("titleTooLong", { max: 200 })),
    projectId: z.string(),
    dueDate: z.string(),
    description: z.string(),
  });
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      projectId: defaultProject,
      dueDate: "",
      description: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createPersonalTaskAction({
        title: values.title,
        description: values.description ?? "",
        dueDate: values.dueDate.trim() ? values.dueDate : null,
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
              maxLength={200}
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
            <Label htmlFor="personal-task-due-date">{t("dueDateLabel")}</Label>
            <Input
              id="personal-task-due-date"
              type="date"
              className="max-w-[220px]"
              data-testid="task-due-date-input"
              disabled={submitting}
              {...register("dueDate")}
            />
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
