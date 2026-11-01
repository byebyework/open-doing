"use client";

import { App, Button, Select } from "antd";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { transferTeamAction } from "../actions";

/** 可转让成员（已排除当前 owner）。 */
export interface TransferCandidate {
  userId: string;
  username: string;
  uid: string;
}

export interface TransferTeamButtonProps {
  teamSlug: string;
  /** 非 owner 成员；为空时按钮禁用。 */
  candidates: TransferCandidate[];
}

/**
 * 「转让团队」按钮（仅 owner 可见）。
 *
 * 在确认弹窗中选择新所有者；成功后原 owner 降为 admin，
 * 团队内容不迁移，设置页刷新后按新角色渲染。
 */
export function TransferTeamButton({ teamSlug, candidates }: TransferTeamButtonProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function handleOpen() {
    setTargetUserId(undefined);
    setOpen(true);
  }

  async function handleConfirm() {
    if (!targetUserId) {
      message.warning(t("selectTransferee"));
      return;
    }

    setSubmitting(true);

    try {
      const result = await transferTeamAction({ teamSlug, targetUserId });

      if (!result.ok) {
        message.error(result.errors.form ?? t("transferFailed"));
        return;
      }

      message.success(t("transferredTeam"));
      setOpen(false);
      setTargetUserId(undefined);
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        disabled={candidates.length === 0}
        title={candidates.length === 0 ? t("noTransferee") : undefined}
        onClick={handleOpen}
      >
        {t("transferTeam")}
      </Button>

      <ConfirmModal
        open={open}
        title={t("transferTeam")}
        content={
          <div>
            <p className="mb-3 text-[13px] text-[#5f6368]">
              {t("transferConfirmIntro")}
            </p>
            <Select
              className="w-full"
              aria-label={t("selectNewOwner")}
              placeholder={t("selectNewOwner")}
              options={candidates.map((candidate) => ({
                value: candidate.userId,
                label: `${candidate.username}（${candidate.uid}）`,
              }))}
              value={targetUserId}
              onChange={(value: string) => setTargetUserId(value)}
            />
          </div>
        }
        confirmText={t("confirmTransfer")}
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
