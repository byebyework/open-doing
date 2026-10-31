import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { parseAnalysisRange } from "@/features/analysis/buckets";
import { SpaceAnalysis } from "@/features/analysis/components/SpaceAnalysis";
import { getTeamSpaceAnalysis } from "@/features/analysis/service";
import { requireUser } from "@/features/auth/session";
import { getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { moduleHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/analysis">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: "Analysis · Open Doing" };

  return { title: `${team.name} Analysis · Open Doing` };
}

/**
 * 团队空间 Analysis（M5）。
 *
 * 权限：团队不存在或非成员一律 404（不泄露存在性）。
 * 取数：`?range=7|30|90` 决定吞吐窗口；缺失 / 非法 / 数组参数回退 30。
 * 成员 / 项目健康度 / 僵尸任务的口径集中在 service，页面只做展示。
 */
export default async function TeamAnalysisPage(
  props: PageProps<"/space/[teamSlug]/analysis">,
) {
  const { teamSlug } = await props.params;
  const { range: rangeParam } = await props.searchParams;

  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const today = todayInShanghai();
  const range = parseAnalysisRange(rangeParam);

  const teamAnalysis = await getTeamSpaceAnalysis({
    teamId: team.id,
    teamSlug: team.slug,
    range,
    today,
  });

  return (
    <SpaceAnalysis
      variant="team"
      range={range}
      today={today}
      basePath={moduleHref(team.slug, "analysis")}
      spaceRef={team.slug}
      personal={null}
      team={teamAnalysis}
    />
  );
}
