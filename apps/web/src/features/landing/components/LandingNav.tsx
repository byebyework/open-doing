import { getTranslations } from "next-intl/server";

import { getRequestLocale } from "@/i18n/server";

import { LandingNavView } from "./LandingNavView";

/**
 * 落地页顶栏：白底毛玻璃 + 底部发丝线，sticky 吸顶。
 *
 * 左侧品牌，中部锚点（<md 隐藏），右侧语言切换 / 登录 / 免费开始。
 * 锚点指向各区块自带的 `id` + `scroll-mt-16`（区块组件负责，避免被
 * sticky 顶栏遮住标题）。本组件是 RSC 外壳：文案经 getTranslations，
 * 语言由 getRequestLocale（与根布局同源，登录态优先、匿名回落 cookie），
 * 展示层在 LandingNavView（纯展示、可被 jsdom 直接挂载测试）。
 */
export async function LandingNav() {
  const t = await getTranslations("landing");
  const locale = await getRequestLocale();

  return (
    <LandingNavView
      skipToContent={t("nav.skipToContent")}
      brandLabel={t("nav.brand")}
      primaryNavLabel={t("nav.primaryNav")}
      links={[
        { href: "#features", label: t("nav.features") },
        { href: "#audiences", label: t("nav.audiences") },
        { href: "#faq", label: t("nav.faq") },
      ]}
      loginLabel={t("nav.login")}
      startLabel={t("nav.start")}
      language={locale}
    />
  );
}
