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
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { changePasswordAction } from "@/features/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/constants";

/**
 * 修改密码表单（个人设置页客户端交互层）。
 *
 * 文案对照 `space-settings-personal.html`「账户安全」卡片。确认密码只在
 * 前端校验；服务端 `AuthError.field` 映射回旧密码 / 新密码输入框，
 * 表单级错误显示在顶部。修改成功后不登出（无状态会话保持不变）。
 */
export function ChangePasswordForm() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z
    .object({
      oldPassword: z.string().min(1, t("oldPasswordRequired")),
      newPassword: z
        .string()
        .min(1, t("newPasswordRequired"))
        .min(
          PASSWORD_MIN_LENGTH,
          t("passwordMinLength", { min: PASSWORD_MIN_LENGTH }),
        ),
      confirmPassword: z.string().min(1, t("confirmPasswordRequired")),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      path: ["confirmPassword"],
      message: t("passwordMismatch"),
    });
  type ChangePasswordValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { oldPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await changePasswordAction({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });

      if (!result.ok) {
        if (result.errors.oldPassword) {
          setError("oldPassword", { message: result.errors.oldPassword });
        }
        if (result.errors.newPassword) {
          setError("newPassword", { message: result.errors.newPassword });
        }
        if (result.errors.form) setFormError(result.errors.form);
        return;
      }

      toast.success(t("passwordUpdated"));
      reset();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="max-w-[460px]">
      {formError ? (
        <Alert variant="destructive" role="alert" className="mb-4">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="settings-old-password">{t("oldPassword")}</Label>
          <Input
            id="settings-old-password"
            type="password"
            data-testid="settings-old-password-input"
            placeholder={t("oldPasswordPlaceholder")}
            autoComplete="current-password"
            aria-invalid={errors.oldPassword ? true : undefined}
            aria-describedby={
              errors.oldPassword ? "settings-old-password-error" : undefined
            }
            disabled={submitting}
            {...register("oldPassword")}
          />
          {errors.oldPassword ? (
            <p id="settings-old-password-error" className="text-[12.5px] text-[var(--error)]">
              {errors.oldPassword.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="settings-new-password">{t("newPassword")}</Label>
          <Input
            id="settings-new-password"
            type="password"
            data-testid="settings-new-password-input"
            placeholder={t("newPasswordPlaceholder", { min: PASSWORD_MIN_LENGTH })}
            autoComplete="new-password"
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={
              errors.newPassword ? "settings-new-password-error" : undefined
            }
            disabled={submitting}
            {...register("newPassword")}
          />
          {errors.newPassword ? (
            <p id="settings-new-password-error" className="text-[12.5px] text-[var(--error)]">
              {errors.newPassword.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="settings-confirm-password">
            {t("confirmPassword")}
          </Label>
          <Input
            id="settings-confirm-password"
            type="password"
            data-testid="settings-confirm-password-input"
            placeholder={t("confirmPasswordPlaceholder")}
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={
              errors.confirmPassword
                ? "settings-confirm-password-error"
                : undefined
            }
            disabled={submitting}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p id="settings-confirm-password-error" className="text-[12.5px] text-[var(--error)]">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={submitting}
            data-testid="settings-update-password-button"
          >
            {submitting ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : null}
            {t("updatePassword")}
          </Button>
          <span className="text-[12px] text-[#9aa0a6]">
            {t("keepLoggedInHint")}
          </span>
        </div>
      </form>
    </div>
  );
}
