"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/shadcn/button";

import { rescindInviteAction } from "../invites/actions";

/**
 * 撤销邀请按钮（客户端交互层）。
 *
 * 失败时以 toast 提示 action 返回的 form 错误（如「邀请不存在或已失效」），
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
        toast.error(result.errors.form ?? t("inviteRescindFailed"));
        return;
      }

      toast.success(t("inviteRescinded"));
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={submitting}
      onClick={handleClick}
    >
      {submitting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
      {t("rescind")}
    </Button>
  );
}
