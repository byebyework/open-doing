import { notFound } from "next/navigation";

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
        aria-label="面包屑"
        className="flex min-w-0 items-center gap-2 text-[13px] text-[#9aa0a6]"
      >
        <span className="shrink-0">{team.name}</span>
        <span aria-hidden="true">/</span>
        <strong className="truncate font-semibold text-[#0e1318]">新建项目</strong>
      </nav>

      <header className="mt-2">
        <h1 className="break-words text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          新建项目
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[#5f6368]">
          团队项目对全体成员可见；任务可指派给团队内任何人。
        </p>
      </header>

      <section className="mt-5 rounded-xl border border-[#e1e3e6] bg-white p-5 shadow-[0_1px_3px_rgba(14,19,24,0.04)]">
        <TeamProjectCreatePanel teamId={team.id} teamSlug={team.slug} />
      </section>
    </div>
  );
}
