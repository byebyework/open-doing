"use client";

import { Button, Select, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { transferTeamAction } from "../actions";

/** 可转让成员（已排除当前 owner）。 */
export interface TransferCandidate {
  userId: string;
  username: string;
  uid: string;
}

export interface TransferTeamButtonProps {
  teamSlug: string;
  /** 非 owner 成员；为空时按钮禁用。 */
  candidates: TransferCandidate[];
}

/**
 * 「转让团队」按钮（仅 owner 可见）。
 *
 * 在确认弹窗中选择新所有者；成功后原 owner 降为 admin，
 * 团队内容不迁移，设置页刷新后按新角色渲染。
 */
export function TransferTeamButton({ teamSlug, candidates }: TransferTeamButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function handleOpen() {
    setTargetUserId(undefined);
    setOpen(true);
  }

  async function handleConfirm() {
    if (!targetUserId) {
      message.warning("请选择受让人");
      return;
    }

    setSubmitting(true);

    try {
      const result = await transferTeamAction({ teamSlug, targetUserId });

      if (!result.ok) {
        message.error(result.errors.form ?? "转让团队失败，请稍后重试");
        return;
      }

      message.success("已转让团队");
      setOpen(false);
      setTargetUserId(undefined);
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        disabled={candidates.length === 0}
        title={candidates.length === 0 ? "团队暂无其他成员可转让" : undefined}
        onClick={handleOpen}
      >
        转让团队
      </Button>

      <ConfirmModal
        open={open}
        title="转让团队"
        content={
          <div>
            <p className="mb-3 text-[13px] text-[#5f6368]">
              转让后受让人将成为团队所有者，你将变为管理员。确定转让团队吗？
            </p>
            <Select
              className="w-full"
              aria-label="选择新的所有者"
              placeholder="选择新的所有者"
              options={candidates.map((candidate) => ({
                value: candidate.userId,
                label: `${candidate.username}（${candidate.uid}）`,
              }))}
              value={targetUserId}
              onChange={(value: string) => setTargetUserId(value)}
            />
          </div>
        }
        confirmText="确认转让"
        loading={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
