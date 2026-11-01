"use client";

import { Alert, Button, Input, message } from "antd";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { spaceDashboardHref } from "@/lib/routes";

import { dissolveTeamAction } from "../actions";

/**
 * 「解散团队」按钮（仅 owner 可见）。
 *
 * 危险操作：确认弹窗内需输入团队名称二次确认；成功后团队及其关联数据
 * 被级联删除，因此离开已不存在的团队页。
 */
export function DissolveTeamButton({ teamSlug, teamName }: { teamSlug: string; teamName: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpen() {
    setTypedName("");
    setOpen(true);
  }

  async function handleConfirm() {
    if (typedName.trim() !== teamName) {
      message.error(t("nameMismatch"));
      return;
    }

    setSubmitting(true);

    try {
      const result = await dissolveTeamAction({ teamSlug });

      if (!result.ok) {
        message.error(result.errors.form ?? t("dissolveFailed"));
        return;
      }

      message.success(t("teamDissolved"));
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
      <Button danger data-testid="dissolve-team-button" onClick={handleOpen}>
        {t("dissolveTeam")}
      </Button>

      <ConfirmModal
        open={open}
        title={t("dissolveTeam")}
        content={
          <div>
            <Alert
              type="error"
              showIcon
              className="mb-4"
              title={t("irreversible")}
              description={t("dissolveWarning", { team: teamName })}
            />
            <label className="mb-2 block text-[13px] font-medium text-[#0e1318]" htmlFor="dissolve-team-name">
              {t("typeTeamName")}
            </label>
            <Input
              id="dissolve-team-name"
              data-testid="dissolve-confirm-input"
              value={typedName}
              placeholder={teamName}
              onChange={(event) => setTypedName(event.target.value)}
            />
          </div>
        }
        confirmText={t("confirmDissolve")}
        danger
        loading={submitting}
        okButtonProps={{ "data-testid": "dissolve-confirm-button" }}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
