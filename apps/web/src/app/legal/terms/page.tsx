import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AGREEMENT_VERSION } from "@/features/auth/constants";

import { LegalDoc } from "../LegalDoc";
import type { LegalSection } from "../legal-doc-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");

  return { title: t("terms.metaTitle") };
}

/** 用户协议页：匿名可访问（不在任何 route group 内，无登录重定向）。 */
export default async function TermsPage() {
  const t = await getTranslations("legal");

  return (
    <LegalDoc
      title={t("terms.title")}
      versionLabel={t("terms.versionLabel")}
      version={AGREEMENT_VERSION}
      effectiveLabel={t("terms.effectiveLabel")}
      effectiveDate={t("terms.effectiveDate")}
      intro={t("terms.intro")}
      sections={t.raw("terms.sections") as LegalSection[]}
    />
  );
}
