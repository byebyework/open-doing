import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/features/auth/session";
import { JoinByCodeForm } from "@/features/teams/joins/components/JoinByCodeForm";
import { createTeamHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("joinTeamTitle") };
}

/**
 * 凭码加入页：输入团队加入码发起申请，由 owner/admin 审批。
 *
 * 本页是静态页；团队空间路由已迁至 /space/[teamSlug]，
 * 不再与团队 slug 冲突。真正取团队按码查询在 server action 内完成。
 */
export default async function JoinTeamPage() {
  await requireUser();
  const t = await getTranslations("teams");

  return (
    <div className="mx-auto w-full max-w-[820px] py-8">
      <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--ink-900)]">{t("joinPageTitle")}</h1>
      <p className="mb-8 mt-1.5 text-[14px] text-[var(--ink-500)]">
        {t("joinPageSubtitle")}
      </p>

      <JoinByCodeForm />

      <p className="mt-8 text-[13px] text-[var(--ink-500)]">
        {t("noJoinCodeBefore")}{" "}
        <Link href={createTeamHref()} className="font-semibold text-[#7d2ae8]">
          {t("createOwnTeam")}
        </Link>
      </p>
    </div>
  );
}
