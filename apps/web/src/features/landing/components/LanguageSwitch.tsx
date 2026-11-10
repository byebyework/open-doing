"use client";

import { LanguagesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import type { AppLocale } from "@/i18n/config";
import { cn } from "@/lib/utils";

import { setAnonymousLocaleAction } from "../actions";

/**
 * 语言按钮文字用各语言自身的短标识（「中」/「EN」），属于语言名本身，
 * 不随界面语言翻译——与个人设置页 LanguageSetting 的母语展示同一惯例。
 */
const LOCALE_OPTIONS = [
  { value: "zh", label: "中" },
  { value: "en", label: "EN" },
] as const satisfies readonly { value: AppLocale; label: string }[];

export interface LanguageSwitchProps {
  /** 当前请求语言（RSC 从 getRequestLocale 读取后传入）。 */
  language: AppLocale;
}

/**
 * 落地页匿名语言切换 chip。
 *
 * 只调用 `setAnonymousLocaleAction` 写 od_locale cookie；action 内
 * `revalidatePath("/")` 让 RSC 以新语言重新渲染，切换后的整页淡入由
 * 落地页的 keyed 包裹承接。pending 期间两个按钮同时禁用，避免连点。
 */
export function LanguageSwitch({ language }: LanguageSwitchProps) {
  const t = useTranslations("landing");
  const [pending, startTransition] = useTransition();

  function handleSelect(next: AppLocale) {
    if (pending || next === language) return;
    startTransition(async () => {
      await setAnonymousLocaleAction({ locale: next });
    });
  }

  return (
    <div
      role="group"
      aria-label={t("nav.languageLabel")}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-white/70 p-0.5 pl-2"
    >
      <LanguagesIcon
        className="size-4 shrink-0 text-[var(--ink-400)]"
        aria-hidden="true"
      />
      {LOCALE_OPTIONS.map((option) => {
        const active = language === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={pending}
            aria-pressed={active}
            data-testid={`language-switch-${option.value}`}
            onClick={() => handleSelect(option.value)}
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center rounded-[var(--radius-pill)] px-2 text-[13px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "font-bold text-primary"
                : "text-[var(--ink-500)] hover:text-[var(--ink-900)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
