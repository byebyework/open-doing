"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * 个人资料卡顶部的 Doing ID 只读行：UID 等宽展示 + 一键复制（复制成功
 * 显示 ✓ 并 toast，失败 toast 提示手动复制）。交互模式与加入码复制
 * （JoinCodeSettings.handleCopy）一致。
 */
export function UidCopyField({ uid }: { uid: string }) {
  const t = useTranslations("users.profile");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(uid);
      setCopied(true);
      toast.success(t("uidCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("uidCopyFailed"));
    }
  }

  return (
    <div
      className="mb-4 flex items-center justify-between gap-4 border-b border-[var(--border-default)] pb-4"
      data-testid="settings-uid-row"
    >
      <span className="text-[13px] font-semibold text-[var(--ink-900)]">
        {t("uidLabel")}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          data-testid="settings-uid-value"
          className="min-w-0 truncate font-mono text-[12.5px] text-[var(--ink-500)]"
        >
          {uid}
        </span>
        <button
          type="button"
          aria-label={t("uidCopy")}
          data-testid="settings-uid-copy"
          className="inline-flex size-8 flex-none items-center justify-center rounded-[var(--radius-8)] text-[var(--ink-500)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <CheckIcon className="size-4 text-[var(--success-500)]" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-4" aria-hidden="true" />
          )}
        </button>
      </span>
    </div>
  );
}
