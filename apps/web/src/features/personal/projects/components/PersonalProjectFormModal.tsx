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
import { Textarea } from "@/components/ui/shadcn/textarea";

import {
  createPersonalProjectAction,
  updatePersonalProjectAction,
} from "../actions";

/** 表单弹窗入参（create 与 edit 共用）。 */
export interface PersonalProjectFormModalProps {
  /** 是否显示。 */
  open: boolean;
  /** 新建或编辑。 */
  mode: "create" | "edit";
  /** 编辑模式下的项目数据。 */
  project?: { id: string; name: string; description?: string };
  /** 提交成功后回调（由调用方关闭弹窗并刷新数据）。 */
  onSuccess: () => void;
  /** 取消 / 关闭。 */
  onCancel: () => void;
}

/**
 * 个人项目新建 / 编辑弹窗。
 *
 * 文案对照 `my-tasks.html`「新建个人项目」弹窗；服务端校验失败时
 * 把 `DomainError.field` 映射回对应表单项，表单级错误显示在顶部。
 * RHF 状态挂在常驻包装件上，Radix Dialog 关闭即卸载内容，打开时重置
 * 表单以还原 antd `resetFields` 语义。
 */
export function PersonalProjectFormModal({
  open,
  mode,
  project,
  onSuccess,
  onCancel,
}: PersonalProjectFormModalProps) {
  const t = useTranslations("personal");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    name: z
      .string()
      .trim()
      .min(1, t("nameRequired"))
      .max(50, t("nameTooLong", { max: 50 })),
    description: z
      .string()
      .max(500, t("descriptionTooLong", { max: 500 })),
  });
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: mode === "edit" ? (project?.name ?? "") : "",
      description: mode === "edit" ? (project?.description ?? "") : "",
    },
  });

  // 每次打开都重置为当前值（关闭期间内容被卸载，但 RHF 状态常驻）。
  useEffect(() => {
    if (open) {
      reset({
        name: mode === "edit" ? (project?.name ?? "") : "",
        description: mode === "edit" ? (project?.description ?? "") : "",
      });
      setFormError(null);
    }
  }, [open, reset, mode, project]);

  const onSubmit = handleSubmit(async (values) => {
    if (mode === "edit" && !project) {
      setFormError(t("missingProject"));
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const input = {
      name: values.name,
      description: values.description ?? "",
    };

    try {
      const result =
        mode === "edit" && project
          ? await updatePersonalProjectAction(project.id, input)
          : await createPersonalProjectAction(input);

      if (!result.ok) {
        if (result.errors.name) {
          setError("name", { message: result.errors.name });
        }
        if (result.errors.description) {
          setError("description", { message: result.errors.description });
        }
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      toast.success(mode === "edit" ? t("projectSaved") : t("projectCreated"));
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("modalTitleCreate") : t("modalTitleEdit")}
          </DialogTitle>
        </DialogHeader>

        <Alert variant="info" className="mb-4">
          {t("infoText")}
        </Alert>

        {formError ? (
          <Alert variant="destructive" role="alert" className="mb-4">
            {formError}
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} noValidate>
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="personal-project-name">{t("nameLabel")}</Label>
            <Input
              id="personal-project-name"
              type="text"
              data-testid="personal-project-name-input"
              placeholder={t("namePlaceholder")}
              maxLength={50}
              autoFocus
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={
                errors.name ? "personal-project-name-error" : undefined
              }
              disabled={submitting}
              {...register("name")}
            />
            {errors.name ? (
              <p id="personal-project-name-error" className="text-[12.5px] text-[var(--error)]">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="personal-project-description">
              {t("descriptionOptional")}
            </Label>
            <Textarea
              id="personal-project-description"
              rows={4}
              placeholder={t("descriptionPlaceholder")}
              disabled={submitting}
              {...register("description")}
            />
            <div className="text-right text-[12px] text-[var(--ink-400)]">
              {watch("description").length} / 500
            </div>
            {errors.description ? (
              <p className="text-[12.5px] text-[var(--error)]">
                {errors.description.message}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onCancel}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="personal-project-submit-button"
            >
              {submitting ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : null}
              {mode === "create" ? t("okCreate") : tCommon("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
