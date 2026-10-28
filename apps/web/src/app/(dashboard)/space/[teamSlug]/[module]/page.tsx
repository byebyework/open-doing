import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui/EmptyState";
import { requireUser } from "@/features/auth/session";
import { getMembership } from "@/features/teams/permissions";
import { getTeamBySlug } from "@/features/teams/service";
import { spaceDashboardHref } from "@/lib/routes";

/** 占位模块 → 展示名（团队 settings 命中真实静态设置页，不进本页）。 */
const MODULE_LABELS = {
  kanban: "Kanban",
  calendar: "Calendar",
  analysis: "Analysis",
  settings: "设置",
} as const;

type PlaceholderModule = keyof typeof MODULE_LABELS;

/** 运行期校验 `[module]` 段：只接受四个在建模块，其余 404。 */
function isPlaceholderModule(value: string): value is PlaceholderModule {
  return Object.hasOwn(MODULE_LABELS, value);
}

export const metadata: Metadata = {
  title: "模块建设中 · Open Doing",
};

/**
 * 空间模块占位页（v1.1 M2）。
 *
 * 路由 `/space/{spaceRef}/{module}` 承接尚未实现的四个模块：
 * - 个人空间直接渲染；
 * - 团队空间按团队页同款 404 语义校验（不存在 / 非成员一律 404，不泄露存在性）；
 * - 团队 settings 由静态路由 `/space/[teamSlug]/settings` 优先命中真实设置页。
 *
 * 注：Next 要求同一位置的动态段名唯一，团队页已占用 `[teamSlug]`，
 * 故本占位页沿用该段名（URL 语义仍是 `spaceRef`：`personal` 或团队 slug）。
 */
export default async function SpaceModulePlaceholderPage(
  props: PageProps<"/space/[teamSlug]/[module]">,
) {
  const { teamSlug: spaceRef, module } = await props.params;

  if (!isPlaceholderModule(module)) notFound();

  if (spaceRef !== "personal") {
    const user = await requireUser();
    // 团队不存在或非成员一律 404，与团队概览 / 设置页一致。
    const team = await getTeamBySlug(spaceRef);
    const membership = team ? await getMembership(team.id, user.id) : null;
    if (!team || !membership) notFound();
  }

  const label = MODULE_LABELS[module];

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1080px]">
      <header className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          {label}
        </h1>
      </header>

      <section className="mt-6 min-w-0 rounded-xl border border-[#e1e3e6] bg-white p-4 shadow-[0_1px_3px_rgba(14,19,24,0.04)] min-[861px]:p-5">
        <EmptyState
          title={label}
          description="该模块将在 v1.1 后续任务上线，当前可先使用 Dashboard。"
          action={
            <Link
              href={spaceDashboardHref(spaceRef)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#7d2ae8] px-3.5 py-2 text-[13.5px] font-semibold text-white no-underline transition-colors hover:bg-[#6b20c9]"
            >
              返回 Dashboard
            </Link>
          }
        />
      </section>
    </div>
  );
}
