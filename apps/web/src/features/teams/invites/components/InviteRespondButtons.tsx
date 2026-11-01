"use client";

import { App, Button } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { respondToInviteAction } from "../actions";

/**
 * 邀请响应按钮（客户端交互层）：接受 / 拒绝。
 *
 * 失效邀请（已撤销 / 团队已解散等）失败时以 message 提示
 * action 返回的 form 错误，而不是报错页。
 */
export function InviteRespondButtons({ inviteId }: { inviteId: string }) {
  const { message } = App.useApp();
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);

  async function handleRespond(accept: boolean) {
    setSubmitting(accept ? "accept" : "decline");

    try {
      const result = await respondToInviteAction({ inviteId, accept });

      if (!result.ok) {
        message.error(result.errors.form ?? t("inviteRespondFailed"));
        return;
      }

      message.success(accept ? t("joinedTeam") : t("declinedInviteToast"));
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <Button type="primary" size="small" data-testid="invite-accept-button" loading={submitting === "accept"} onClick={() => handleRespond(true)}>
        {t("accept")}
      </Button>
      <Button size="small" data-testid="invite-decline-button" loading={submitting === "decline"} onClick={() => handleRespond(false)}>
        {t("decline")}
      </Button>
    </span>
  );
}
