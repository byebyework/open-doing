import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { SpaceCalendar } from "@/features/calendar/components/SpaceCalendar";
import { getTeamSpaceCalendar } from "@/features/calendar/service";
import { listTeamProjects } from "@/features/projects/service";
import { getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { moduleHref, teamTaskHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(
  props: PageProps<"/space/[teamSlug]/calendar">,
): Promise<Metadata> {
  const { teamSlug } = await props.params;
  const user = await requireUser();

  // 非成员不通过标题泄露团队名（页面本身也会 404）。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) return { title: "Calendar · Open Doing" };

  return { title: `${team.name} Calendar · Open Doing` };
}

/** `?month=YYYY-MM` 合法格式（月份段 01–12）；其余一律回退当前月。 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 团队空间 Calendar（v1.1 M2）。
 *
 * 权限：团队不存在或非成员一律 404（不泄露存在性）。
 * 取数：`?month=YYYY-MM` 决定月网格窗口；缺失 / 非法 / 数组参数静默回退
 * 当前月。翻月交互下沉到 client 组件，写回 URL。
 */
export default async function TeamCalendarPage(
  props: PageProps<"/space/[teamSlug]/calendar">,
) {
  const { teamSlug } = await props.params;
  const { month: monthParam } = await props.searchParams;

  const user = await requireUser();

  // 团队不存在或非成员一律 404，不泄露存在性。
  const team = await getTeamBySlug(teamSlug);
  const membership = team ? await getMembership(team.id, user.id) : null;
  if (!team || !membership) notFound();

  const today = todayInShanghai();
  const month =
    typeof monthParam === "string" && MONTH_PATTERN.test(monthParam)
      ? monthParam
      : today.slice(0, 7);

  const data = await getTeamSpaceCalendar(team.id, month, today);

  // 卡片只有 projectId；href 需要 project slug，用当前项目列表反查。
  const projects = await listTeamProjects(team.id);
  const projectSlugById = new Map(
    projects.map((project) => [project.id, project.slug]),
  );
  const taskHrefs: Record<string, string> = {};
  for (const card of [...data.items, ...data.weekItems, ...data.monthUpcoming]) {
    const projectSlug = card.projectId
      ? projectSlugById.get(card.projectId)
      : undefined;
    if (projectSlug) {
      taskHrefs[card.id] = teamTaskHref(team.slug, projectSlug, card.id);
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <header className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          Calendar
        </h1>
        <p className="mt-1.5 text-[14px] text-[#5f6368]">
          团队任务日历:按截止日期看本月分布,右侧是本周清单与本月临期提醒。成员可见全部任务。
        </p>
      </header>

      <div className="mt-5">
        <SpaceCalendar
          variant="team"
          month={month}
          today={today}
          data={data}
          taskHrefs={taskHrefs}
          basePath={moduleHref(team.slug, "calendar")}
        />
      </div>
    </div>
  );
}
