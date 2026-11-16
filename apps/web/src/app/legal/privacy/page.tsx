import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AGREEMENT_VERSION } from "@/features/auth/constants";

import { LegalDoc } from "../LegalDoc";
import type { LegalSection } from "../legal-doc-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");

  return { title: t("privacy.metaTitle") };
}

/** 隐私政策页：匿名可访问（不在任何 route group 内，无登录重定向）。 */
export default async function PrivacyPage() {
  const t = await getTranslations("legal");

  return (
    <LegalDoc
      title={t("privacy.title")}
      versionLabel={t("privacy.versionLabel")}
      version={AGREEMENT_VERSION}
      effectiveLabel={t("privacy.effectiveLabel")}
      effectiveDate={t("privacy.effectiveDate")}
      intro={t("privacy.intro")}
      sections={t.raw("privacy.sections") as LegalSection[]}
    />
  );
}
