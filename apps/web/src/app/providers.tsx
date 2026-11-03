"use client";

import type { ReactNode } from "react";

import type { AppLocale } from "@/i18n/config";

import { Toaster } from "@/components/ui/shadcn/sonner";

/** Providers 入口参数。 */
export interface ProvidersProps {
  children: ReactNode;
  /**
   * 请求级 locale(根布局从 i18n/server 解析后传入)。
   *
   * 组件文案经 next-intl 的消息目录随请求切换；`html lang` 由根布局按
   * `LOCALE_HTML_LANG` 写入——本组件不再持有 UI 库 locale。
   */
  locale: AppLocale;
}

/**
 * 根布局专用包裹：注入全局 Toaster（sonner）。
 *
 * shadcn 迁移完成后不再有 antd 的 AntdRegistry / ConfigProvider / App
 * 上下文；主题令牌来自 `tokens.css`（globals.css 引入），无运行时主题。
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
