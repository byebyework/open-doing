"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { rescindInviteAction } from "../invites/actions";

/**
 * 撤销邀请按钮（客户端交互层）。
 *
 * 失败时以 message 提示 action 返回的 form 错误（如「邀请不存在或已失效」），
 * 成功后刷新服务端数据更新待处理列表。
 */
export function RescindInviteButton({ inviteId, teamId }: { inviteId: string; teamId: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);

    try {
      const result = await rescindInviteAction({ inviteId, teamId });

      if (!result.ok) {
        message.error(result.errors.form ?? t("inviteRescindFailed"));
        return;
      }

      message.success(t("inviteRescinded"));
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button type="text" danger size="small" loading={submitting} onClick={handleClick}>
      {t("rescind")}
    </Button>
  );
}
