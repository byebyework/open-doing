"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
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

import { createInviteAction } from "../invites/actions";

/**
 * 邀请成员表单（客户端交互层）：输入对方 UID 即可邀请。
 *
 * 输入框带 `doing_` 前缀，用户只填后缀（对照 team-settings 原型）；
 * 校验与错误文案（「UID 无效」等）在 server action。
 */
export function InviteMemberForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // zod schema 在组件内构建:必填文案取自 next-intl。
  const schema = z.object({
    uid: z.string().min(1, t("uidRequired")),
  });
  type InviteValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(schema),
    defaultValues: { uid: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createInviteAction({
        teamId,
        actorId: "",
        uid: `doing_${values.uid.trim()}`,
      });

      if (!result.ok) {
        applyActionErrors(result.errors, {
          setFieldError: (name, message) =>
            setError(name as keyof InviteValues, { message }),
          onFormError: setFormError,
        });
        return;
      }

      toast.success(t("inviteSent"));
      setValue("uid", "");
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
          <Label htmlFor="invite-uid">{t("uidLabel")}</Label>
          {/* doing_ 前缀壳：复刻 antd Input prefix 的形态（对照 team-settings 原型）。 */}
          <div className="flex h-9 items-center rounded-[var(--radius-8)] border border-input bg-card px-3 shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] focus-within:ring-ring/40">
            <span className="select-none text-[14px] text-[#9aa0a6]" aria-hidden="true">
              doing_
            </span>
            <Input
              id="invite-uid"
              type="text"
              className="h-7 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              placeholder={t("uidPlaceholder")}
              maxLength={6}
              data-testid="invite-uid-input"
              autoFocus
              aria-invalid={errors.uid ? true : undefined}
              aria-describedby={errors.uid ? "invite-uid-error" : undefined}
              disabled={submitting}
              {...register("uid")}
            />
          </div>
          {errors.uid ? (
            <p id="invite-uid-error" className="text-[12.5px] text-[var(--error)]">
              {errors.uid.message}
            </p>
          ) : (
            <p className="text-[12px] text-[#9aa0a6]">{t("uidExtra")}</p>
          )}
        </div>

        <Button type="submit" disabled={submitting} data-testid="invite-send-button">
          {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("sendInvite")}
        </Button>
      </form>
    </div>
  );
}
