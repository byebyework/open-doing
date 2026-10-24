"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { removeMemberAction } from "../actions";

/** 移除成员按钮入参。 */
export interface RemoveMemberButtonProps {
  teamSlug: string;
  targetUserId: string;
  targetUsername: string;
}

/**
 * 成员行「移除」按钮（owner/admin 可见）。
 *
 * 二次确认后调用 server action；失败时展示 action 返回的 form 错误
 * （如角色已变化），成功后刷新成员列表。
 */
export function RemoveMemberButton({
  teamSlug,
  targetUserId,
  targetUsername,
}: RemoveMemberButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const result = await removeMemberAction({ teamSlug, targetUserId });

      if (!result.ok) {
        message.error(result.errors.form ?? "移除成员失败，请稍后重试");
        return;
      }

      message.success("已移除成员");
      setOpen(false);
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="text" danger size="small" onClick={() => setOpen(true)}>
        移除
      </Button>

      <ConfirmModal
        open={open}
        title="移除成员"
        content={`确定将「${targetUsername}」移出团队吗？其负责的任务将变为未指派。`}
        confirmText="移除"
        danger
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
