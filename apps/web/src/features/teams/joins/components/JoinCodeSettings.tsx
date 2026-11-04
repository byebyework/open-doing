"use client";

import { CheckIcon, CopyIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { Switch } from "@/components/ui/shadcn/switch";

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
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [enabled, setEnabled] = useState(joinCodeEnabled);
  const [syncedEnabled, setSyncedEnabled] = useState(joinCodeEnabled);
  const [toggling, setToggling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);

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
        toast.error(result.errors.form ?? t("joinCodeSettingsFailed"));
        setEnabled(previous);
        return;
      }

      toast.success(nextEnabled ? t("joinCodeEnabledOnToast") : t("joinCodeEnabledOffToast"));
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
      setEnabled(previous);
    } finally {
      setToggling(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyJoinCodeFailed"));
    }
  }

  async function handleReset() {
    setResetting(true);

    try {
      const result = await resetJoinCodeAction({ teamId });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("joinCodeResetFailedUi"));
        return;
      }

      toast.success(t("joinCodeResetDone"));
      setConfirming(false);
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] text-[var(--ink-500)]">{t("joinCodeLabel")}</span>
        <span
          data-testid="join-code-value"
          className="font-mono text-[16px] font-semibold tracking-[0.12em] text-[var(--ink-900)]"
        >
          {joinCode}
        </span>
        <button
          type="button"
          aria-label={t("copyJoinCode")}
          className="inline-flex size-8 items-center justify-center rounded-[var(--radius-8)] text-[var(--ink-500)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <CheckIcon className="size-4 text-[var(--success-500)]" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-4" aria-hidden="true" />
          )}
        </button>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={resetting}
          onClick={() => setConfirming(true)}
        >
          {resetting ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {t("joinCodeReset")}
        </Button>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <Switch
          data-testid="join-code-switch"
          checked={enabled}
          disabled={toggling}
          onCheckedChange={handleToggle}
        />
        <span className="text-[13px] text-[var(--ink-500)]">
          {enabled ? t("joinCodeEnabledOn") : t("joinCodeEnabledOff")}
        </span>
      </label>

      <ConfirmModal
        open={confirming}
        title={t("joinCodeReset")}
        content={t("joinCodeResetConfirm")}
        confirmText={t("reset")}
        danger
        loading={resetting}
        onConfirm={handleReset}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
