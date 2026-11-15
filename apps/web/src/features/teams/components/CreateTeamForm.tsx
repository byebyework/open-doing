"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CharCounter } from "@/components/ui/CharCounter";
import { NAME_MAX_LENGTH } from "../constants";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/shadcn/radio-group";
import { applyActionErrors } from "@/lib/action-form";
import { teamSettingsHref } from "@/lib/routes";

import { createTeamAction } from "../actions";

/**
 * 创建团队表单（客户端交互层）。
 *
 * 校验为交互体验兜底，真正的校验与错误文案在 server action；
 * 成功后导航到团队设置页并刷新服务端数据（侧栏即时出现新团队）。
 */
export function CreateTeamForm() {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    name: z.string().min(1, t("nameRequired")),
    kind: z.enum(["real", "virtual"], { message: t("kindInvalid") }),
  });
  type CreateTeamValues = z.infer<typeof schema>;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
    watch,
  } = useForm<CreateTeamValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", kind: "real" },
  });

  const nameValue = watch("name");

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createTeamAction({
        name: values.name,
        kind: values.kind,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof CreateTeamValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      router.push(teamSettingsHref(result.data.slug));
      router.refresh();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div>
      {formError ? (
        <Alert variant="destructive" role="alert" className="mb-5">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="create-team-name">{t("nameLabel")}</Label>
          <Input
            id="create-team-name"
            type="text"
            className="h-10"
            placeholder={t("namePlaceholder")}
            maxLength={30}
            data-testid="team-name-input"
            autoFocus
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "create-team-name-error" : undefined}
            disabled={submitting}
            {...register("name")}
          />
          <CharCounter value={nameValue} max={NAME_MAX_LENGTH} />
            {errors.name ? (
            <p id="create-team-name-error" className="text-[12.5px] text-[var(--error)]">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <Label id="create-team-kind-label">{t("kindLabel")}</Label>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <RadioGroup
                name={field.name}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                disabled={submitting}
                aria-labelledby="create-team-kind-label"
                aria-invalid={errors.kind ? true : undefined}
                aria-describedby={
                  errors.kind ? "create-team-kind-error" : undefined
                }
                className="flex flex-col gap-2.5"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    id="create-team-kind-real"
                    value="real"
                    data-testid="team-kind-real"
                    aria-label={t("kindReal")}
                  />
                  <Label
                    htmlFor="create-team-kind-real"
                    className="text-[13px] font-normal text-[var(--ink-700)]"
                  >
                    {t("kindReal")}
                  </Label>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      id="create-team-kind-virtual"
                      value="virtual"
                      data-testid="team-kind-virtual"
                      aria-label={t("kindVirtual")}
                    />
                    <Label
                      htmlFor="create-team-kind-virtual"
                      className="text-[13px] font-normal text-[var(--ink-700)]"
                    >
                      {t("kindVirtual")}
                    </Label>
                  </div>
                  <p className="pl-6 text-[12px] text-[var(--ink-500)]">
                    {t("kindVirtualHint")}
                  </p>
                </div>
              </RadioGroup>
            )}
          />
          {errors.kind ? (
            <p
              id="create-team-kind-error"
              className="text-[12.5px] text-[var(--error)]"
            >
              {errors.kind.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full font-semibold"
          disabled={submitting}
          data-testid="create-team-button"
        >
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("createTitle")}
        </Button>
      </form>
    </div>
  );
}
