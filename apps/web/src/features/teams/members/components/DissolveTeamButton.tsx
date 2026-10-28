"use client";

import { Alert, Button, Input, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { spaceDashboardHref } from "@/lib/routes";

import { dissolveTeamAction } from "../actions";

/**
 * 「解散团队」按钮（仅 owner 可见）。
 *
 * 危险操作：确认弹窗内需输入团队名称二次确认；成功后团队及其关联数据
 * 被级联删除，因此离开已不存在的团队页。
 */
export function DissolveTeamButton({ teamSlug, teamName }: { teamSlug: string; teamName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpen() {
    setTypedName("");
    setOpen(true);
  }

  async function handleConfirm() {
    if (typedName.trim() !== teamName) {
      message.error("输入的团队名称不匹配");
      return;
    }

    setSubmitting(true);

    try {
      const result = await dissolveTeamAction({ teamSlug });

      if (!result.ok) {
        message.error(result.errors.form ?? "解散团队失败，请稍后重试");
        return;
      }

      message.success("团队已解散");
      setOpen(false);
      router.push(spaceDashboardHref("personal"));
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button danger onClick={handleOpen}>
        解散团队
      </Button>

      <ConfirmModal
        open={open}
        title="解散团队"
        content={
          <div>
            <Alert
              type="error"
              showIcon
              className="mb-4"
              title="此操作不可撤销"
              description={`「${teamName}」下全部项目、任务、评论与通知将被永久删除。`}
            />
            <label className="mb-2 block text-[13px] font-medium text-[#0e1318]" htmlFor="dissolve-team-name">
              请输入团队名称以确认
            </label>
            <Input
              id="dissolve-team-name"
              value={typedName}
              placeholder={teamName}
              onChange={(event) => setTypedName(event.target.value)}
            />
          </div>
        }
        confirmText="确认解散"
        danger
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
