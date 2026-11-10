import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/shadcn/button";
import { getRequestLocale } from "@/i18n/server";

import { LanguageSwitch } from "./LanguageSwitch";

/**
 * 落地页顶栏：白底毛玻璃 + 底部发丝线，sticky 吸顶。
 *
 * 左侧品牌，中部锚点（<md 隐藏），右侧语言切换 / 登录 / 免费开始。
 * 锚点指向各区块自带的 `id` + `scroll-mt-16`（区块组件负责，避免被
 * sticky 顶栏遮住标题）。RSC：文案经 getTranslations，语言由
 * getRequestLocale（与根布局同源，登录态优先、匿名回落 cookie）。
 */
export async function LandingNav() {
  const t = await getTranslations("landing");
  const locale = await getRequestLocale();

  const navLinks = [
    { href: "#features", label: t("nav.features") },
    { href: "#audiences", label: t("nav.audiences") },
    { href: "#faq", label: t("nav.faq") },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-default)] bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        {/* 品牌：图标 + 字标（字标是专有名词，不翻译） */}
        <Link
          href="/"
          className="inline-flex shrink-0 items-center gap-2.5 rounded-[var(--radius-btn)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <BrandMark className="h-8 w-8" />
          <span className="hidden text-[15px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)] sm:inline">
            Open Doing
          </span>
        </Link>

        {/* 中部锚点：移动端隐藏 */}
        <nav className="hidden flex-1 items-center justify-center gap-7 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded text-[13px] font-medium text-[var(--ink-500)] transition-colors duration-150 hover:text-[var(--purple-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* 右侧操作区 */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4 md:ml-0">
          <LanguageSwitch language={locale} />
          <Link
            href="/login"
            className="hidden rounded text-[13px] font-medium text-[var(--ink-700)] transition-colors duration-150 hover:text-[var(--purple-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:inline-flex"
          >
            {t("nav.login")}
          </Link>
          <Button asChild variant="gradient" size="lg" className="font-semibold">
            <Link href="/register">{t("nav.start")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
