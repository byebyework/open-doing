import { getTranslations } from "next-intl/server";

import { HeroAnimated, type HeroCopy } from "./HeroAnimated";

/**
 * 落地页首屏 RSC 外壳：从 `landing.hero` 读取全部文案，以可序列化的
 * `HeroCopy` 传入客户端动效组件（客户端不直接依赖 next-intl）。
 */
export async function Hero() {
  const t = await getTranslations("landing");

  const copy: HeroCopy = {
    badge: t("hero.badge"),
    titleLine1: t("hero.titleLine1"),
    titleLine2: t("hero.titleLine2"),
    subtitle: t("hero.subtitle"),
    ctaStart: t("hero.ctaStart"),
    ctaLogin: t("hero.ctaLogin"),
    trust: t("hero.trust"),
    reminderCard: t("hero.reminderCard"),
  };

  return <HeroAnimated copy={copy} />;
}
