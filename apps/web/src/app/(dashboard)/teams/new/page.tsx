import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/features/auth/session";
import { CreateTeamForm } from "@/features/teams/components/CreateTeamForm";
import { joinTeamHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("createTeamTitle") };
}

/** 创建团队页：成功后创建者自动成为 owner 并跳转团队设置。 */
export default async function CreateTeamPage() {
  await requireUser();
  const t = await getTranslations("teams");

  return (
    <div className="mx-auto w-full max-w-[520px] py-10">
      <h1 data-testid="create-team-heading" className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)]">
        {t("createTitle")}
      </h1>
      <p className="mb-8 mt-1.5 text-[14px] text-[var(--ink-500)]">{t("createSubtitle")}</p>

      <CreateTeamForm />

      <p className="mt-8 text-center text-[13px] text-[var(--ink-500)]">
        {t("haveJoinCode")}{" "}
        <Link href={joinTeamHref()} className="font-semibold text-[#7d2ae8]">
          {t("joinByCode")}
        </Link>
      </p>
    </div>
  );
}
