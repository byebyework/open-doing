"use client";

import { motion } from "motion/react";
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
 * 当前语言指示胶囊的 layoutId：两颗按钮共享，切换时 Motion 把胶囊
 * 从旧语言滑到新语言（transform 类动画，MotionConfig reducedMotion
 * "user" 下自动失效为瞬时定位）。
 */
const ACTIVE_PILL_LAYOUT_ID = "landing-language-active-pill";

/**
 * 落地页匿名语言切换 chip（分段控件款：浅灰轨道 + 白色指示胶囊 +
 * 弱投影，当前语言加粗主题紫，对齐 mockup lang-chip 的紧凑观感）。
 *
 * 视觉高度只有 28px 以免在顶栏里突兀；触控命中区用伪元素纵向外扩
 * 回 44px（`before:-inset-y-2`，横向不外扩避免相邻按钮命中区重叠）。
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
      try {
        await setAnonymousLocaleAction({ locale: next });
      } catch {
        // 静默失败：按钮只会发送合法 locale（typed 失败走 { ok:false }），
        // 这里兜住意外抛出，避免 unhandled rejection 让 transition 卡在 pending。
      }
    });
  }

  return (
    <div
      role="group"
      aria-label={t("nav.languageLabel")}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] bg-(--ink-900)/[0.04] p-[3px]"
    >
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
              "relative inline-flex h-7 items-center justify-center rounded-[var(--radius-pill)] px-3 text-[13px] leading-none transition-colors duration-150 before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "font-semibold text-primary"
                : "text-[var(--ink-500)] hover:text-[var(--ink-900)]",
            )}
          >
            {active && (
              <motion.span
                layoutId={ACTIVE_PILL_LAYOUT_ID}
                aria-hidden="true"
                className="absolute inset-0 rounded-[var(--radius-pill)] bg-(--surface-white) shadow-[var(--shadow-rest)]"
                transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
