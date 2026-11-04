"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { spaceDashboardHref } from "@/lib/routes";
import { applyActionErrors } from "@/lib/action-form";

import { registerAction } from "../actions";
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../constants";

/**
 * 注册表单（客户端交互层）。
 *
 * 确认密码只在前端校验；服务端 action 只接收用户名 + 密码。
 * 注册成功后 action 写入会话 cookie，页面直接进入个人空间首页。
 */
export function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:文案取自 next-intl;确认密码一致用 refine 前端校验。
  const schema = z
    .object({
      username: z
        .string()
        .min(1, t("usernameRequired"))
        .min(USERNAME_MIN_LENGTH, t("usernameLength", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }))
        .max(USERNAME_MAX_LENGTH, t("usernameLength", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })),
      password: z
        .string()
        .min(1, t("passwordRequired"))
        .min(PASSWORD_MIN_LENGTH, t("passwordMinLength", { min: PASSWORD_MIN_LENGTH })),
      confirmPassword: z.string().min(1, t("confirmPasswordRequired")),
    })
    .refine((values) => values.password === values.confirmPassword, {
      path: ["confirmPassword"],
      message: t("passwordMismatch"),
    });
  type RegisterValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await registerAction({
        username: values.username,
        password: values.password,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof RegisterValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      router.push(spaceDashboardHref("personal"));
      router.refresh();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div>
      <span
        className="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[19px] font-extrabold text-white"
        aria-hidden="true"
      >
        O
      </span>

      <h1 className="mb-2 mt-5 text-[26px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)]">
        {t("createAccount")}
      </h1>
      <p className="mb-6 text-[14px] text-[var(--ink-500)]">{t("registerSubtitle")}</p>

      {formError ? (
        <Alert variant="destructive" role="alert" className="mb-5">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-username">{t("usernameLabel")}</Label>
          <Input
            id="register-username"
            type="text"
            className="h-10"
            placeholder={t("usernameRegisterPlaceholder")}
            data-testid="auth-username-input"
            autoComplete="username"
            autoFocus
            aria-invalid={errors.username ? true : undefined}
            aria-describedby={
              errors.username ? "register-username-error" : "register-username-extra"
            }
            disabled={submitting}
            {...register("username")}
          />
          {errors.username ? (
            <p id="register-username-error" className="text-[12.5px] text-[var(--error)]">
              {errors.username.message}
            </p>
          ) : (
            <p id="register-username-extra" className="text-[12px] text-[var(--ink-400)]">
              {t("usernameExtra", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH })}
            </p>
          )}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-password">{t("passwordLabel")}</Label>
          <Input
            id="register-password"
            type="password"
            className="h-10"
            placeholder={t("passwordRegisterPlaceholder")}
            data-testid="auth-password-input"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "register-password-error" : undefined}
            disabled={submitting}
            {...register("password")}
          />
          {errors.password ? (
            <p id="register-password-error" className="text-[12.5px] text-[var(--error)]">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-confirm-password">{t("confirmPasswordLabel")}</Label>
          <Input
            id="register-confirm-password"
            type="password"
            className="h-10"
            placeholder={t("confirmPasswordPlaceholder")}
            data-testid="auth-password-confirm-input"
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={
              errors.confirmPassword ? "register-confirm-password-error" : undefined
            }
            disabled={submitting}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p
              id="register-confirm-password-error"
              className="text-[12.5px] text-[var(--error)]"
            >
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>

        <div className="mb-5 flex gap-2 rounded-lg bg-[#eaf5ff] px-4 py-3 text-[12.5px] leading-[1.5] text-[#0b6fb8]">
          <span aria-hidden="true">ℹ</span>
          <span>
            {t("uidHintBefore")}{" "}
            <b className="font-mono">doing_xxxx</b>{" "}
            {t("uidHintAfter")}
          </span>
        </div>

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          className="w-full font-semibold"
          disabled={submitting}
          data-testid="auth-submit-button"
        >
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("signUpButton")}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-[var(--ink-500)]">
        {t("hasAccount")}{" "}
        <Link href="/login" className="font-semibold text-[#7d2ae8]">
          {t("signInInstead")}
        </Link>
      </p>
    </div>
  );
}
