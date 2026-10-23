"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
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
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);

    try {
      const result = await rescindInviteAction({ inviteId, teamId });

      if (!result.ok) {
        message.error(result.errors.form ?? "撤销邀请失败，请稍后重试");
        return;
      }

      message.success("已撤销邀请");
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button type="text" danger size="small" loading={submitting} onClick={handleClick}>
      撤销
    </Button>
  );
}
