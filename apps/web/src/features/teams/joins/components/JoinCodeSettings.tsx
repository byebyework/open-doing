"use client";

import { Button, message, Switch, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { resetJoinCodeAction, setJoinCodeEnabledAction } from "../actions";

export interface JoinCodeSettingsProps {
  teamId: string;
  /** 当前团队加入码（RSC 传入，刷新后随服务端数据更新）。 */
  joinCode: string;
  /** 凭码加入开关的初始值。 */
  joinCodeEnabled: boolean;
}

/**
 * 凭码加入设置（客户端交互层）：展示/复制加入码、开关凭码加入、重置加入码。
 *
 * 开关先乐观更新，失败时回弹到操作前的值；重置是破坏性操作，走 ConfirmModal
 * 二次确认（旧码立即失效）。成功后 `router.refresh()` 让 RSC 重新取数。
 */
export function JoinCodeSettings({
  teamId,
  joinCode,
  joinCodeEnabled,
}: JoinCodeSettingsProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(joinCodeEnabled);
  const [syncedEnabled, setSyncedEnabled] = useState(joinCodeEnabled);
  const [toggling, setToggling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 渲染期同步 props → state：action 成功后 refresh 带来新的服务端值。
  if (joinCodeEnabled !== syncedEnabled) {
    setSyncedEnabled(joinCodeEnabled);
    setEnabled(joinCodeEnabled);
  }

  async function handleToggle(nextEnabled: boolean) {
    const previous = enabled;
    // 乐观更新：开关立即反馈，失败时回弹。
    setEnabled(nextEnabled);
    setToggling(true);

    try {
      const result = await setJoinCodeEnabledAction({ teamId, enabled: nextEnabled });

      if (!result.ok) {
        message.error(result.errors.form ?? "保存凭码加入设置失败，请稍后重试");
        setEnabled(previous);
        return;
      }

      message.success(nextEnabled ? "已开启凭码加入" : "已关闭凭码加入");
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
      setEnabled(previous);
    } finally {
      setToggling(false);
    }
  }

  async function handleReset() {
    setResetting(true);

    try {
      const result = await resetJoinCodeAction({ teamId });

      if (!result.ok) {
        message.error(result.errors.form ?? "重置加入码失败，请稍后重试");
        return;
      }

      message.success("加入码已重置");
      setConfirming(false);
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] text-[#5f6368]">团队加入码</span>
        <Typography.Text
          copyable
          className="font-mono text-[16px] font-semibold tracking-[0.12em] text-[#0e1318]"
        >
          {joinCode}
        </Typography.Text>
        <Button
          className="ml-auto"
          loading={resetting}
          onClick={() => setConfirming(true)}
        >
          重置加入码
        </Button>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <Switch checked={enabled} loading={toggling} onChange={handleToggle} />
        <span className="text-[13px] text-[#5f6368]">
          {enabled ? "已开启：成员可凭码申请加入" : "已关闭：成员无法凭码加入"}
        </span>
      </label>

      <ConfirmModal
        open={confirming}
        title="重置加入码"
        content="重置后旧加入码立即失效，尚未处理完的申请不受影响；请把新码重新告知成员。"
        confirmText="重置"
        danger
        loading={resetting}
        onConfirm={handleReset}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
