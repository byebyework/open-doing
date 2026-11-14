"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * 值一键复制按钮（图标钮）：写入剪贴板 + toast 反馈。
 *
 * - toast 走 sonner（全局 Toaster），成功文案带被复制的值；
 * - 成功后短暂切换为 ✓，2 秒还原——视觉反馈与 toast 双通道；
 * - 剪贴板 API 不可用（非安全上下文 / 旧浏览器）时报失败 toast。
 */
export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!navigator.clipboard?.writeText) {
      toast.error(t("copyFailed"));
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copyCopied", { value }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-500)] transition-colors duration-150 hover:bg-[var(--muted)] hover:text-[var(--ink-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {copied ? (
        <CheckIcon size={13} aria-hidden="true" />
      ) : (
        <CopyIcon size={13} aria-hidden="true" />
      )}
    </button>
  );
}
