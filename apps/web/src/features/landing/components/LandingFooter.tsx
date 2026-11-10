import { getTranslations } from "next-intl/server";

/**
 * 落地页页脚：顶部发丝线 + 极简单行。
 *
 * 左侧版权（landing.footer.copyright），右侧三个锚点链接复用导航文案
 * （landing.nav.*），即设计文档 §4.7 的 `© 2026 Open Doing` + 三个锚点。
 * 锚点指向各区块自带的 `id` + `scroll-mt-16`，与 LandingNav 同一约定。
 */
export async function LandingFooter() {
  const t = await getTranslations("landing");

  const navLinks = [
    { href: "#features", label: t("nav.features") },
    { href: "#audiences", label: t("nav.audiences") },
    { href: "#faq", label: t("nav.faq") },
  ];

  return (
    <footer className="border-t border-[var(--border-default)] bg-[var(--surface-white)]">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-8 sm:px-6">
        <span className="text-[12px] text-[var(--ink-400)]">
          {t("footer.copyright")}
        </span>
        <nav className="flex items-center gap-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded text-[12px] text-[var(--ink-400)] transition-colors duration-150 hover:text-[var(--purple-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
