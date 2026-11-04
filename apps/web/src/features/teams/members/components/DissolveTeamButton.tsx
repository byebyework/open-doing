"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/shadcn/alert";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
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
      toast.error(t("nameMismatch"));
      return;
    }

    setSubmitting(true);

    try {
      const result = await dissolveTeamAction({ teamSlug });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("dissolveFailed"));
        return;
      }

      toast.success(t("teamDissolved"));
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
        data-testid="dissolve-team-button"
        onClick={handleOpen}
      >
        {t("dissolveTeam")}
      </Button>

      <ConfirmModal
        open={open}
        title={t("dissolveTeam")}
        content={
          <div>
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>{t("irreversible")}</AlertTitle>
              <AlertDescription>{t("dissolveWarning", { team: teamName })}</AlertDescription>
            </Alert>
            <label className="mb-2 block text-[13px] font-medium text-[var(--ink-900)]" htmlFor="dissolve-team-name">
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
