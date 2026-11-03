"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";

import { removeMemberAction } from "../actions";

/** 移除成员按钮入参。 */
export interface RemoveMemberButtonProps {
  teamSlug: string;
  targetUserId: string;
  targetUsername: string;
}

/**
 * 成员行「移除」按钮（owner/admin 可见）。
 *
 * 二次确认后调用 server action；失败时展示 action 返回的 form 错误
 * （如角色已变化），成功后刷新成员列表。
 */
export function RemoveMemberButton({
  teamSlug,
  targetUserId,
  targetUsername,
}: RemoveMemberButtonProps) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const result = await removeMemberAction({ teamSlug, targetUserId });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("removeFailed"));
        return;
      }

      toast.success(t("memberRemoved"));
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        data-testid="member-remove-button"
        onClick={() => setOpen(true)}
      >
        {t("remove")}
      </Button>

      <ConfirmModal
        open={open}
        title={t("removeMemberTitle")}
        content={t("removeMemberConfirm", { name: targetUsername })}
        confirmText={t("remove")}
        danger
        loading={submitting}
        okButtonProps={{ "data-testid": "member-remove-confirm-button" }}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
