"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { cancelJoinRequestAction } from "../actions";

/**
 * 取消加入申请按钮（客户端交互层）。
 *
 * 破坏性操作走 `ConfirmModal` 二次确认；失败时以 message 提示 action 返回的
 * form 错误（如「加入申请不存在或已失效」），成功后刷新服务端数据。
 */
export function CancelJoinRequestButton({
  requestId,
  teamName,
}: {
  requestId: string;
  teamName: string;
}) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const result = await cancelJoinRequestAction({ requestId });

      if (!result.ok) {
        message.error(result.errors.form ?? t("cancelRequestFailedUi"));
        return;
      }

      message.success(t("cancelRequestDone"));
      setConfirming(false);
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="text" danger size="small" onClick={() => setConfirming(true)}>
        {t("cancelRequest")}
      </Button>

      <ConfirmModal
        open={confirming}
        title={t("cancelRequest")}
        content={t("cancelRequestConfirm", { team: teamName })}
        confirmText={t("cancelRequest")}
        danger
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
