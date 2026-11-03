"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/shadcn/button";

import { respondToInviteAction } from "../actions";

/**
 * 邀请响应按钮（客户端交互层）：接受 / 拒绝。
 *
 * 失效邀请（已撤销 / 团队已解散等）失败时以 toast 提示
 * action 返回的 form 错误，而不是报错页。
 */
export function InviteRespondButtons({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);

  async function handleRespond(accept: boolean) {
    setSubmitting(accept ? "accept" : "decline");

    try {
      const result = await respondToInviteAction({ inviteId, accept });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("inviteRespondFailed"));
        return;
      }

      toast.success(accept ? t("joinedTeam") : t("declinedInviteToast"));
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <Button
        size="sm"
        disabled={submitting !== null}
        data-testid="invite-accept-button"
        onClick={() => handleRespond(true)}
      >
        {submitting === "accept" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
        {t("accept")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={submitting !== null}
        data-testid="invite-decline-button"
        onClick={() => handleRespond(false)}
      >
        {submitting === "decline" ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
        {t("decline")}
      </Button>
    </span>
  );
}
