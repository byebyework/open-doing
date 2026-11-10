import { getRequestLocale } from "@/i18n/server";

import { AudiencesSection } from "./AudiencesSection";
import { CtaSection } from "./CtaSection";
import { FaqSection } from "./FaqSection";
import { FeaturesSection } from "./FeaturesSection";
import { Hero } from "./Hero";
import { LandingContent } from "./LandingContent";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";

/**
 * 落地页 RSC 组合：按 mockup 顺序把各区块拼成一页。
 *
 * 文案在各自的 RSC / 客户端区块内取自 `landing` 命名空间；本组件只负责
 * 解析请求级 locale（登录态优先、匿名回落 cookie），交给 LandingContent
 * 作为整页淡入的 key。区块以 children 传入客户端外壳，客户端不接触
 * next-intl 的 server 入口。
 */
export async function LandingPage() {
  const locale = await getRequestLocale();

  return (
    <LandingContent locale={locale}>
      <LandingNav />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <FeaturesSection />
        <AudiencesSection />
        <FaqSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </LandingContent>
  );
}
