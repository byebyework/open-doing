"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/shadcn/radio-group";
import { applyActionErrors } from "@/lib/action-form";

import { updateProfileAction } from "../actions";
import {
  EMAIL_PATTERN,
  GENDER_VALUES,
  NICKNAME_MAX_LENGTH,
  PHONE_PATTERN,
} from "../constants";
import type { UserProfile } from "../service";

/** 性别单选的展示顺序与文案 key（与服务端 Gender 枚举一致）。 */
const GENDER_OPTIONS = [
  { value: "male", labelKey: "genderMale" },
  { value: "female", labelKey: "genderFemale" },
  { value: "secret", labelKey: "genderSecret" },
] as const;

export interface ProfileFormProps {
  /** 当前用户资料（RSC 传入，可跨边界序列化）。 */
  profile: UserProfile;
}

/**
 * 个人资料表单（个人设置页客户端交互层）。
 *
 * 字段顺序与注册表单一致：昵称 / 性别 / 邮箱 / 电话，均为选填。前端校验
 * 与服务端 updateProfile 同规则；服务端字段错误经 UserError -> action
 * 映射回对应输入框。昵称留空表示保持当前昵称，其它资料留空表示清空。
 * 保存成功后用服务端归一化值回填并 toast，再 refresh 让页面取最新资料。
 */
export function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter();
  const t = useTranslations("users.profile");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建：文案取自 next-intl。
  const schema = z.object({
    nickname: z
      .string()
      .refine(
        (value) => value.trim().length <= NICKNAME_MAX_LENGTH,
        t("nicknameMaxLength", { max: NICKNAME_MAX_LENGTH }),
      ),
    gender: z.enum(GENDER_VALUES).optional(),
    email: z
      .string()
      .refine(
        (value) => value.trim() === "" || EMAIL_PATTERN.test(value.trim()),
        t("emailInvalid"),
      ),
    phone: z
      .string()
      .refine(
        (value) => value.trim() === "" || PHONE_PATTERN.test(value.trim()),
        t("phoneInvalid"),
      ),
  });
  type ProfileValues = z.infer<typeof schema>;

  /** 领域资料 → 表单值（null 统一为空串 / 未选中）。 */
  function toFormValues(value: UserProfile): ProfileValues {
    return {
      nickname: value.nickname ?? "",
      gender: value.gender ?? undefined,
      email: value.email ?? "",
      phone: value.phone ?? "",
    };
  }

  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<ProfileValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(profile),
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await updateProfileAction({
        nickname: values.nickname,
        gender: values.gender,
        email: values.email,
        phone: values.phone,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof ProfileValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      // 用服务端归一化后的值回填，避免大小写 / 空白差异残留在输入框里。
      reset(toFormValues(result.data));
      toast.success(t("saved"));
      router.refresh();
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
          <Label htmlFor="profile-nickname">{t("nicknameLabel")}</Label>
          <Input
            id="profile-nickname"
            type="text"
            data-testid="profile-nickname-input"
            autoComplete="nickname"
            aria-invalid={errors.nickname ? true : undefined}
            aria-describedby={
              errors.nickname ? "profile-nickname-error" : undefined
            }
            disabled={submitting}
            {...register("nickname")}
          />
          {errors.nickname ? (
            <p id="profile-nickname-error" className="text-[12.5px] text-[var(--error)]">
              {errors.nickname.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label id="profile-gender-label">{t("genderLabel")}</Label>
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
                aria-labelledby="profile-gender-label"
                aria-invalid={errors.gender ? true : undefined}
                aria-describedby={
                  errors.gender ? "profile-gender-error" : undefined
                }
                className="flex flex-wrap items-center gap-x-5 gap-y-2"
              >
                {GENDER_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem
                      id={`profile-gender-${option.value}`}
                      value={option.value}
                      data-testid={`profile-gender-${option.value}`}
                      aria-label={t(option.labelKey)}
                    />
                    <Label
                      htmlFor={`profile-gender-${option.value}`}
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
            <p id="profile-gender-error" className="text-[12.5px] text-[var(--error)]">
              {errors.gender.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="profile-email">{t("emailLabel")}</Label>
          <Input
            id="profile-email"
            type="email"
            data-testid="profile-email-input"
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            inputMode="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "profile-email-error" : undefined}
            disabled={submitting}
            {...register("email")}
          />
          {errors.email ? (
            <p id="profile-email-error" className="text-[12.5px] text-[var(--error)]">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="profile-phone">{t("phoneLabel")}</Label>
          <Input
            id="profile-phone"
            type="tel"
            data-testid="profile-phone-input"
            placeholder={t("phonePlaceholder")}
            autoComplete="tel"
            inputMode="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "profile-phone-error" : undefined}
            disabled={submitting}
            {...register("phone")}
          />
          {errors.phone ? (
            <p id="profile-phone-error" className="text-[12.5px] text-[var(--error)]">
              {errors.phone.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          data-testid="profile-submit-button"
        >
          {submitting ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : null}
          {tCommon("save")}
        </Button>
      </form>
    </div>
  );
}
