"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { applyActionErrors } from "@/lib/action-form";
import { invitesHref } from "@/lib/routes";

import { createJoinRequestAction } from "../actions";

/**
 * 凭码加入表单（客户端交互层）：输入 8 位团队加入码发起审批申请。
 *
 * 码的格式、存在性与重复申请校验在 server action（service 侧剔除空白 + 大写）；
 * 错误按字段落回输入框 / 表单顶部，成功后重置输入并引导到邀请页查看进度。
 */
export function JoinByCodeForm() {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    code: z.string().min(1, t("joinCodeRequired")),
  });
  type JoinValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<JoinValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createJoinRequestAction({ code: values.code });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof JoinValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      toast.success(t("joinSubmitted"));
      setValue("code", "");
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
        <Alert variant="destructive" role="alert" className="mb-4">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="join-code">{t("joinCodeLabel")}</Label>
          <Input
            id="join-code"
            type="text"
            className="h-10"
            placeholder={t("joinCodePlaceholder")}
            spellCheck={false}
            autoComplete="off"
            data-testid="join-code-input"
            autoFocus
            aria-invalid={errors.code ? true : undefined}
            aria-describedby={errors.code ? "join-code-error" : undefined}
            disabled={submitting}
            {...register("code")}
          />
          {errors.code ? (
            <p id="join-code-error" className="text-[12.5px] text-[var(--error)]">
              {errors.code.message}
            </p>
          ) : (
            <p className="text-[12px] text-[var(--ink-400)]">{t("joinCodeHint")}</p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          data-testid="join-submit-button"
        >
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("submitRequest")}
        </Button>
      </form>

      <p className="mt-5 text-[13px] text-[var(--ink-500)]">
        {t("trackBefore")}{" "}
        <Link href={invitesHref()} className="font-semibold text-[var(--purple-600)]">
          {t("invitesTitle")}
        </Link>{" "}
        {t("trackAfter")}
      </p>
    </div>
  );
}
