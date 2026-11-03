"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { applyActionErrors } from "@/lib/action-form";

import { renameTeamAction } from "../actions";

/**
 * 团队改名表单（客户端交互层）。
 *
 * slug 不随改名变化；校验与权限在 server action 端再校验。
 */
export function RenameTeamForm({ teamId, name }: { teamId: string; name: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    name: z.string().min(1, t("nameRequired")),
  });
  type RenameTeamValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RenameTeamValues>({
    resolver: zodResolver(schema),
    defaultValues: { name },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await renameTeamAction({ teamId, name: values.name });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (fieldName, message) =>
            setError(fieldName as keyof RenameTeamValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      toast.success(t("saved"));
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
          <Label htmlFor="rename-team-name">{t("nameLabel")}</Label>
          <Input
            id="rename-team-name"
            type="text"
            placeholder={t("nameLabel")}
            maxLength={30}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "rename-team-name-error" : undefined}
            disabled={submitting}
            {...register("name")}
          />
          {errors.name ? (
            <p id="rename-team-name-error" className="text-[12.5px] text-[var(--error)]">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("saveChanges")}
        </Button>
      </form>
    </div>
  );
}
