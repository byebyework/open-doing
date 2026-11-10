"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

import { OD_EASE } from "@/components/ui/overlay-motion";
import type { AppLocale } from "@/i18n/config";

/** LandingContent 入参：请求级 locale 与 RSC 组合好的全部区块。 */
export interface LandingContentProps {
  /** 当前请求语言；作为 key 让语言切换后的整页重新淡入。 */
  locale: AppLocale;
  children: ReactNode;
}

/**
 * 落地页整页淡入包裹。
 *
 * 区块全部由 RSC 组合后作为 children 传入（客户端组件不依赖 next-intl）。
 * 匿名语言切换会写 od_locale cookie 并 revalidatePath("/")，RSC 以新 locale
 * 重渲染；`key={locale}` 触发的重挂载让整页重新淡入。刻意不用
 * AnimatePresence / mode="wait"——它与 Server Action 触发的 RSC 刷新不兼容
 * （见设计文档 §3 的决定）。
 */
export function LandingContent({ locale, children }: LandingContentProps) {
  return (
    <motion.div
      key={locale}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: OD_EASE.standard }}
    >
      {children}
    </motion.div>
  );
}
