"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { respondToInviteAction } from "../actions";

/**
 * 邀请响应按钮（客户端交互层）：接受 / 拒绝。
 *
 * 失效邀请（已撤销 / 团队已解散等）失败时以 message 提示
 * action 返回的 form 错误，而不是报错页。
 */
export function InviteRespondButtons({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);

  async function handleRespond(accept: boolean) {
    setSubmitting(accept ? "accept" : "decline");

    try {
      const result = await respondToInviteAction({ inviteId, accept });

      if (!result.ok) {
        message.error(result.errors.form ?? "处理邀请失败，请稍后重试");
        return;
      }

      message.success(accept ? "已加入团队" : "已拒绝邀请");
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <Button type="primary" size="small" loading={submitting === "accept"} onClick={() => handleRespond(true)}>
        接受
      </Button>
      <Button size="small" loading={submitting === "decline"} onClick={() => handleRespond(false)}>
        拒绝
      </Button>
    </span>
  );
}
