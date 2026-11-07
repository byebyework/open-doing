import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CARD_SHELL } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { TeamProjectCreatePanel } from "@/features/projects/components/TeamProjectForm";
import { can, getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";

interface NewTeamProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ teamSlug: string }>;
}

/**
 * 新建团队项目页（J-1）。
 *
 * 仅 owner/admin 可进入：不存在的团队、非成员、member 一律 404，
 * 不披露团队或权限细节；action 层同样鉴权。
 */
export default async function NewTeamProjectPage({
  params,
}: NewTeamProjectPageProps) {
  const { teamSlug } = await params;
  const t = await getTranslations("projects");
  const tCommon = await getTranslations("common");

  const user = await requireUser();
  const team = await getTeamBySlug(teamSlug);

  if (!team) notFound();

  const membership = await getMembership(team.id, user.id);
  if (!can(membership?.role ?? null, "team:manage_projects")) {
    notFound();
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[680px]">
      <nav
        aria-label={tCommon("breadcrumb")}
        className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink-400)]"
      >
        <span className="shrink-0">{team.name}</span>
        <span aria-hidden="true">/</span>
        <strong className="truncate font-semibold text-[var(--ink-900)]">{t("newProjectTitle")}</strong>
      </nav>

      <PageHeader
        className="mt-2"
        title={t("newProjectTitle")}
        subtitle={t("newProjectHint")}
      />

      <section className={`mt-5 ${CARD_SHELL} p-5`}>
        <TeamProjectCreatePanel teamId={team.id} teamSlug={team.slug} />
      </section>
    </div>
  );
}
