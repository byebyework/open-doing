"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { spaceDashboardHref } from "@/lib/routes";

import { leaveTeamAction } from "../actions";

/**
 * 「退出团队」按钮（member/admin 可见，owner 由页面隐藏）。
 *
 * 退出后任务保留、assignee 置空；成功后跳转个人空间首页（原团队页已无权访问）。
 */
export function LeaveTeamButton({ teamSlug }: { teamSlug: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const result = await leaveTeamAction({ teamSlug });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("leaveFailed"));
        return;
      }

      toast.success(t("leftTeam"));
      setOpen(false);
      router.push(spaceDashboardHref("personal"));
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
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-[var(--error-bg)] hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        {t("leaveTeam")}
      </Button>

      <ConfirmModal
        open={open}
        title={t("leaveTeam")}
        content={t("leaveTeamConfirm")}
        confirmText={t("leaveTeam")}
        danger
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
