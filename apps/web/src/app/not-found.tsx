"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * 全局 404 页面。
 *
 * 根布局下的未命中路由与 `notFound()` 均渲染此页；
 * 不在 dashboard 外壳内，避免 404 时出现侧栏上下文。
 */
export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--surface-subtle)] p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p
          className="bg-[image:var(--brand-gradient)] bg-clip-text text-[56px] font-extrabold leading-none tracking-[-0.02em] text-transparent"
          aria-hidden="true"
        >
          404
        </p>
        <h1 className="text-[18px] font-semibold text-[var(--ink-900)]">
          {t("title")}
        </h1>
        <p className="text-[14px] text-[var(--ink-500)]" data-testid="not-found-message">
          {t("message")}
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex h-10 items-center rounded-md bg-[image:var(--brand-gradient)] px-6 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
