"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { leaveTeamAction } from "../actions";

/**
 * 「退出团队」按钮（member/admin 可见，owner 由页面隐藏）。
 *
 * 退出后任务保留、assignee 置空；成功后跳转 /my（原团队页已无权访问）。
 */
export function LeaveTeamButton({ teamSlug }: { teamSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const result = await leaveTeamAction({ teamSlug });

      if (!result.ok) {
        message.error(result.errors.form ?? "退出团队失败，请稍后重试");
        return;
      }

      message.success("已退出团队");
      setOpen(false);
      router.push("/my");
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button danger onClick={() => setOpen(true)}>
        退出团队
      </Button>

      <ConfirmModal
        open={open}
        title="退出团队"
        content="退出后你负责的任务将变为未指派，由管理员重新分配。确定退出团队吗？"
        confirmText="退出团队"
        danger
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
