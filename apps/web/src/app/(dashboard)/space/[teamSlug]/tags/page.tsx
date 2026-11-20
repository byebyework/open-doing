import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { TagsModuleView } from "@/features/tags/components/TagsModuleView";
import { can, getMembership } from "@/features/teams/permissions";
import { listTags } from "@/features/tags/service";
import { getTeamBySlug } from "@/features/teams/service";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/tags">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const t = await getTranslations("labels");
  const tNav = await getTranslations("nav");
  const user = await requireUser();

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: t("title") };

  return {
    title: `${t("title")} · ${team.name} · ${await tNav("tags")}`,
  };
}

/** 团队空间标签模块：成员只读可见；owner/admin 可管理（管理动作按权限渲染）。 */
export default async function TeamTagsPage(
  props: PageProps<"/space/[teamSlug]/tags">,
) {
  const { teamSlug } = await props.params;
  const t = await getTranslations("labels");
  const user = await requireUser();

  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const tags = await listTags({ teamId: team.id });

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-6">
        <TagsModuleView
          space={{ kind: "team", teamId: team.id }}
          initialTags={tags}
          canManage={can(membership.role, "team:manage_projects")}
        />
      </div>
    </div>
  );
}
