"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { HintBadge } from "@/components/ui/HintBadge";
import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/shadcn/radio-group";
import { spaceDashboardHref } from "@/lib/routes";
import { applyActionErrors } from "@/lib/action-form";

import { registerAction } from "../actions";
import {
  EMAIL_PATTERN,
  NICKNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../constants";
import type { AuthInput } from "../service";

/** 性别单选的三个取值（与服务端 AuthInput 的枚举一致）。 */
const GENDER_VALUES = ["male", "female", "secret"] as const;

const GENDER_OPTIONS = [
  { value: "male", labelKey: "genderMale" },
  { value: "female", labelKey: "genderFemale" },
  { value: "secret", labelKey: "genderSecret" },
] as const;

export interface RegisterPayloadValues {
  username: string;
  password: string;
  /** 注册码（封测）：表单必填；空值原样提交，由服务端报「请输入注册码」。 */
  registrationCode: string;
  nickname?: string;
  gender?: string;
  email?: string;
  phone?: string;
}

/**
 * 表单值 → Server Action 入参。
 *
 * 注册码必填，trim 后原样携带（空字符串交给服务端报错）；可选资料与
 * 用户输入方式保持一致：trim 后为空视为未填，直接省略该键，
 * 与服务端「空字符串归一化为 null」的规则对齐。
 */
export function buildRegisterPayload(values: RegisterPayloadValues): AuthInput {
  const payload: AuthInput = {
    username: values.username,
    password: values.password,
    registrationCode: values.registrationCode.trim(),
  };

  const nickname = values.nickname?.trim();
  if (nickname) payload.nickname = nickname;

  const gender = values.gender?.trim();
  if (gender) payload.gender = gender;

  const email = values.email?.trim();
  if (email) payload.email = email;

  const phone = values.phone?.trim();
  if (phone) payload.phone = phone;

  return payload;
}

/**
 * 注册表单（客户端交互层）。
 *
 * 用户名/密码/确认密码必填；昵称、性别、邮箱、电话选填，前端校验规则与
 * 服务端 registerUser 一致。确认密码只在前端校验；注册成功后 action 写入
 * 会话 cookie，页面直接进入个人空间首页。
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
      registrationCode: z.string().min(1, t("registrationCodeRequired")),
      nickname: z
        .string()
        .refine(
          (value) => value.trim().length <= NICKNAME_MAX_LENGTH,
          t("nicknameMaxLength", { max: NICKNAME_MAX_LENGTH }),
        )
        .optional(),
      gender: z.enum(GENDER_VALUES).optional(),
      email: z
        .string()
        .refine(
          (value) => value.trim() === "" || EMAIL_PATTERN.test(value.trim()),
          t("emailInvalid"),
        )
        .optional(),
      phone: z
        .string()
        .refine(
          (value) => value.trim() === "" || PHONE_PATTERN.test(value.trim()),
          t("phoneInvalid"),
        )
        .optional(),
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
    control,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      registrationCode: "",
      nickname: "",
      gender: undefined,
      email: "",
      phone: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await registerAction(buildRegisterPayload(values));

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
        className="grid h-10 w-10 place-items-center rounded-xl bg-[image:var(--brand-gradient)] text-[19px] font-extrabold text-white"
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
              {t("usernameExtra")}
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

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-nickname">{t("nicknameLabel")}</Label>
          <Input
            id="register-nickname"
            type="text"
            className="h-10"
            placeholder={t("nicknamePlaceholder")}
            data-testid="auth-nickname-input"
            autoComplete="nickname"
            aria-invalid={errors.nickname ? true : undefined}
            aria-describedby={errors.nickname ? "register-nickname-error" : undefined}
            disabled={submitting}
            {...register("nickname")}
          />
          {errors.nickname ? (
            <p id="register-nickname-error" className="text-[12.5px] text-[var(--error)]">
              {errors.nickname.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label id="register-gender-label">{t("genderLabel")}</Label>
          <Controller
            control={control}
            name="gender"
            render={({ field }) => (
              <RadioGroup
                name={field.name}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                disabled={submitting}
                aria-labelledby="register-gender-label"
                aria-invalid={errors.gender ? true : undefined}
                aria-describedby={errors.gender ? "register-gender-error" : undefined}
                className="flex flex-wrap items-center gap-x-5 gap-y-2"
              >
                {GENDER_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem
                      id={`register-gender-${option.value}`}
                      value={option.value}
                      data-testid={`auth-gender-${option.value}`}
                      aria-label={t(option.labelKey)}
                    />
                    <Label
                      htmlFor={`register-gender-${option.value}`}
                      className="text-[13px] font-normal text-[var(--ink-700)]"
                    >
                      {t(option.labelKey)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
          {errors.gender ? (
            <p id="register-gender-error" className="text-[12.5px] text-[var(--error)]">
              {errors.gender.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-email">{t("emailLabel")}</Label>
          <Input
            id="register-email"
            type="email"
            className="h-10"
            placeholder={t("emailPlaceholder")}
            data-testid="auth-email-input"
            autoComplete="email"
            inputMode="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "register-email-error" : undefined}
            disabled={submitting}
            {...register("email")}
          />
          {errors.email ? (
            <p id="register-email-error" className="text-[12.5px] text-[var(--error)]">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-phone">{t("phoneLabel")}</Label>
          <Input
            id="register-phone"
            type="tel"
            className="h-10"
            placeholder={t("phonePlaceholder")}
            data-testid="auth-phone-input"
            autoComplete="tel"
            inputMode="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "register-phone-error" : undefined}
            disabled={submitting}
            {...register("phone")}
          />
          {errors.phone ? (
            <p id="register-phone-error" className="text-[12.5px] text-[var(--error)]">
              {errors.phone.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="register-registration-code">{t("registrationCodeLabel")}</Label>
          <Input
            id="register-registration-code"
            type="text"
            className="h-10 font-mono uppercase"
            placeholder={t("registrationCodePlaceholder")}
            data-testid="auth-registration-code-input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={errors.registrationCode ? true : undefined}
            aria-describedby={
              errors.registrationCode ? "register-registration-code-error" : undefined
            }
            disabled={submitting}
            {...register("registrationCode")}
          />
          {errors.registrationCode ? (
            <p id="register-registration-code-error" className="text-[12.5px] text-[var(--error)]">
              {errors.registrationCode.message}
            </p>
          ) : null}
        </div>

        {/* UID 信息块收敛为 ⓘ 徽章：GA 摘要 + 弹层保留原有文案与示例格式。 */}
        <div className="mb-5 flex justify-end">
          <HintBadge
            ariaLabel={t("uidHintAria")}
            summary={t("uidHintSummary")}
            title={t("uidHintTitle")}
          >
            {t("uidHintBefore")}{" "}
            <b className="font-mono">doing_xxxx</b>{" "}
            {t("uidHintAfter")}
          </HintBadge>
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
        <Link href="/login" className="font-semibold text-[var(--purple-600)]">
          {t("signInInstead")}
        </Link>
      </p>
    </div>
  );
}
