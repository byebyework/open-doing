"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
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
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const result = await cancelJoinRequestAction({ requestId });

      if (!result.ok) {
        message.error(result.errors.form ?? "取消加入申请失败，请稍后重试");
        return;
      }

      message.success("已取消加入申请");
      setConfirming(false);
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="text" danger size="small" onClick={() => setConfirming(true)}>
        取消申请
      </Button>

      <ConfirmModal
        open={confirming}
        title="取消加入申请"
        content={`确定取消向「${teamName}」的加入申请吗？取消后可凭同一加入码重新申请。`}
        confirmText="取消申请"
        danger
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
