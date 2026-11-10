import Link from "next/link";

import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/shadcn/button";
import type { AppLocale } from "@/i18n/config";

import { LanguageSwitch } from "./LanguageSwitch";

/** 导航锚点（href + 已翻译文案）。 */
export interface LandingNavLink {
  href: string;
  label: string;
}

export interface LandingNavViewProps {
  /** 跳转链接文案（landing.nav.skipToContent）。 */
  skipToContent: string;
  /** 品牌链接 aria-label（landing.nav.brand）。 */
  brandLabel: string;
  /** 中部 nav 地标的 aria-label（landing.nav.primaryNav）。 */
  primaryNavLabel: string;
  /** 中部锚点（功能 / 个人 vs 团队 / 常见问题）。 */
  links: LandingNavLink[];
  /** 登录链接文案（landing.nav.login）。 */
  loginLabel: string;
  /** 免费开始按钮文案（landing.nav.start）。 */
  startLabel: string;
  /** 当前请求语言，透传给匿名语言切换 chip。 */
  language: AppLocale;
}

/**
 * 顶栏的纯展示层：不触碰 next-intl 的 server 入口与请求级 locale，
 * 可被 jsdom 直接挂载测试（见 LandingNav.test.tsx）。RSC 外壳在
 * LandingNav——只负责取文案与语言后透传 props。
 *
 * 布局：左侧品牌，中部锚点（<md 隐藏），右侧语言切换 / 登录 / 免费开始。
 * 锚点指向各区块自带的 `id` + `scroll-mt-16`（区块组件负责，避免被
 * sticky 顶栏遮住标题）。链接命中区用 px-2 -mx-2 外扩到 ≥44px 高宽
 * （外扩负 margin 保持视觉不变）；品牌链接是纯图标位时以 min-w-11 保底。
 */
export function LandingNavView({
  skipToContent,
  brandLabel,
  primaryNavLabel,
  links,
  loginLabel,
  startLabel,
  language,
}: LandingNavViewProps) {
  return (
    <>
      {/* 跳转链接：聚焦时浮出，直达 main，供键盘与读屏用户跳过顶栏锚点 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-btn)] focus:bg-[var(--surface-white)] focus:px-4 focus:py-2.5 focus:text-[14px] focus:font-semibold focus:text-[var(--ink-900)] focus:shadow-[var(--shadow-card-hover)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--primary)]"
      >
        {skipToContent}
      </a>
      <header className="sticky top-0 z-30 border-b border-[var(--border-default)] bg-(--surface-white)/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
          {/* 品牌：图标 + 字标（字标是专有名词，不翻译） */}
          <Link
            href="/"
            aria-label={brandLabel}
            className="inline-flex min-h-11 min-w-11 shrink-0 -my-1.5 items-center justify-center gap-2.5 rounded-[var(--radius-btn)] transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <BrandMark className="h-8 w-8" />
            <span
              translate="no"
              className="hidden text-[15px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)] sm:inline"
            >
              Open Doing
            </span>
          </Link>

          {/* 中部锚点：移动端隐藏 */}
          <nav
            aria-label={primaryNavLabel}
            className="hidden flex-1 items-center justify-center gap-7 md:flex"
          >
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 -my-4 items-center rounded px-2 -mx-2 py-4 text-[13px] font-medium text-[var(--ink-500)] transition-colors duration-150 hover:text-[var(--purple-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* 右侧操作区 */}
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4 md:ml-0">
            <LanguageSwitch language={language} />
            <Link
              href="/login"
              className="hidden min-h-11 -my-4 items-center rounded px-2 -mx-2 py-4 text-[13px] font-medium text-[var(--ink-700)] transition-colors duration-150 hover:text-[var(--purple-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:inline-flex"
            >
              {loginLabel}
            </Link>
            <Button
              asChild
              variant="gradient"
              size="lg"
              className="h-11 text-[14px] font-semibold"
            >
              <Link href="/register" data-testid="landing-register-nav">
                {startLabel}
              </Link>
            </Button>
          </div>
        </div>
      </header>
    </>
  );
}
