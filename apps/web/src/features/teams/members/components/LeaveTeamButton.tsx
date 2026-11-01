"use client";

import { App, Button } from "antd";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { spaceDashboardHref } from "@/lib/routes";

import { leaveTeamAction } from "../actions";

/**
 * 「退出团队」按钮（member/admin 可见，owner 由页面隐藏）。
 *
 * 退出后任务保留、assignee 置空；成功后跳转个人空间首页（原团队页已无权访问）。
 */
export function LeaveTeamButton({ teamSlug }: { teamSlug: string }) {
  const { message } = App.useApp();
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
        message.error(result.errors.form ?? t("leaveFailed"));
        return;
      }

      message.success(t("leftTeam"));
      setOpen(false);
      router.push(spaceDashboardHref("personal"));
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button danger onClick={() => setOpen(true)}>
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
