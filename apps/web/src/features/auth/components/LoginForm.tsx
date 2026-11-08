"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { HintBadge } from "@/components/ui/HintBadge";
import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { spaceDashboardHref } from "@/lib/routes";
import { BrandMark } from "@/components/ui/BrandMark";
import { applyActionErrors } from "@/lib/action-form";

import { loginAction } from "../actions";

/**
 * 登录表单（客户端交互层）。
 *
 * 校验为交互体验兜底，真正的认证与恒定错误文案在 server action。
 * 成功后写入 httpOnly 会话 cookie，再导航到个人空间首页。
 */
export function LoginForm() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    username: z.string().min(1, t("usernameRequired")),
    password: z.string().min(1, t("passwordRequired")),
  });
  type LoginValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await loginAction({
        username: values.username,
        password: values.password,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof LoginValues, { message }),
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
      <BrandMark className="h-10 w-10" />

      <h1 className="mb-2 mt-5 text-[26px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)]">
        {t("welcomeBack")}
      </h1>
      <p className="mb-7 text-[14px] text-[var(--ink-500)]">{t("loginSubtitle")}</p>

      {formError ? (
        <Alert variant="destructive" role="alert" className="mb-5">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="login-username">{t("usernameLabel")}</Label>
          <Input
            id="login-username"
            type="text"
            className="h-10"
            placeholder={t("usernamePlaceholder")}
            data-testid="auth-username-input"
            autoComplete="username"
            autoFocus
            aria-invalid={errors.username ? true : undefined}
            aria-describedby={errors.username ? "login-username-error" : undefined}
            disabled={submitting}
            {...register("username")}
          />
          {errors.username ? (
            <p id="login-username-error" className="text-[12.5px] text-[var(--error)]">
              {errors.username.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="login-password">{t("passwordLabel")}</Label>
          <Input
            id="login-password"
            type="password"
            className="h-10"
            placeholder={t("passwordPlaceholder")}
            data-testid="auth-password-input"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "login-password-error" : undefined}
            disabled={submitting}
            {...register("password")}
          />
          {errors.password ? (
            <p id="login-password-error" className="text-[12.5px] text-[var(--error)]">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        <div className="-mt-1 mb-4 flex justify-end">
          {/* 密码找回说明收敛为 ⓘ 徽章：摘要常驻，明细点开可见。 */}
          <HintBadge
            ariaLabel={t("noPasswordRecoveryAria")}
            summary={t("noPasswordRecovery")}
            title={t("noPasswordRecoveryTitle")}
            items={[t("noPasswordRecoveryDetail")]}
          />
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
          {t("signInButton")}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-[var(--ink-500)]">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-semibold text-[var(--purple-600)]">
          {t("registerNow")}
        </Link>
      </p>
    </div>
  );
}
