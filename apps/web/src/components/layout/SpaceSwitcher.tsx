"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";

import {
  createTeamHref,
  joinTeamHref,
  spaceDashboardHref,
} from "@/lib/routes";

/** 切换器展示所需的最小团队数据（由 Sidebar 服务端取数后传入）。 */
export interface SpaceSwitcherTeam {
  slug: string;
  name: string;
}

/** SpaceSwitcher 入参。 */
export interface SpaceSwitcherProps {
  /** 当前用户所属团队，按服务端返回顺序渲染。 */
  teams: SpaceSwitcherTeam[];
}

/**
 * 计算当前路由所属的空间 key。
 *
 * `/space/personal` 及其子路径命中个人空间（`"personal"`）；
 * `/space/{slug}` 及其子路径命中对应团队（slug ∈ teamSlugs 时）；
 * 其余路由（如 `/invites`、`/teams/new`）不选中任何空间。
 * 作为纯函数导出，便于在 node 环境单独测试。
 */
export function selectedSpaceKey(
  pathname: string,
  teamSlugs: string[],
): string | null {
  // 与团队一致用 `/` 边界判断，覆盖 /space/personal/tasks/[taskId] 等子路由。
  if (pathname === "/space/personal" || pathname.startsWith("/space/personal/"))
    return "personal";

  for (const slug of teamSlugs) {
    const base = `/space/${slug}`;
    // 用 `/` 边界判断前缀，避免 `/space/growthx` 误命中 `growth`。
    if (pathname === base || pathname.startsWith(`${base}/`)) return slug;
  }

  return null;
}

/**
 * 侧栏空间切换器（S4 实装）。
 *
 * 菜单结构与原型一致：个人空间 / 我的团队 / 创建团队 / 凭码加入；
 * 团队列表由 Sidebar（server）通过 `listTeamsForUser` 取数后传入，
 * 当前选中项由 `usePathname` 推导，点击菜单项用 `router.push` 跳转。
 * 组件边界仍按 F-5 契约保留在 Sidebar 内，布局导入关系不变。
 */
export function SpaceSwitcher({ teams }: SpaceSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");

  const teamSlugs = teams.map((team) => team.slug);
  const selectedKey = selectedSpaceKey(pathname, teamSlugs);
  // 团队项 key 加 `team:` 前缀，避免与 personal / create-team / join-team 冲突。
  const selectedMenuKey =
    selectedKey === null
      ? null
      : selectedKey === "personal"
        ? "personal"
        : `team:${selectedKey}`;
  // 触发按钮沿用原型：有归属团队时展示团队名，否则回退为个人空间。
  const currentLabel =
    teams.find((team) => team.slug === selectedKey)?.name ?? t("personalSpace");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="space-switcher-trigger"
          className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg border border-[#e1e3e6] bg-white px-2.5 py-2 text-left text-[13px] transition-colors hover:border-[#c7cdd3] hover:bg-[#f4f5f7]"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#7d2ae8]" />
          <span className="min-w-0 flex-1 truncate font-semibold text-[#0e1318]">
            {currentLabel}
          </span>
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-[#9aa0a6]"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      {/* 菜单宽度跟随触发器（antd 菜单默认不小于触发器宽度）。 */}
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-48"
      >
        <DropdownMenuLabel>{t("personal")}</DropdownMenuLabel>
        <DropdownMenuItem
          data-selected={selectedMenuKey === "personal" ? "" : undefined}
          onSelect={() => router.push(spaceDashboardHref("personal"))}
        >
          {t("personalSpace")}
        </DropdownMenuItem>
        {/* 无团队时省略分组标题，避免出现空分组。 */}
        {teams.length > 0 ? (
          <>
            <DropdownMenuLabel>{t("myTeams")}</DropdownMenuLabel>
            {teams.map((team) => (
              <DropdownMenuItem
                key={team.slug}
                data-selected={
                  selectedMenuKey === `team:${team.slug}` ? "" : undefined
                }
                onSelect={() => router.push(spaceDashboardHref(team.slug))}
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#9b87f5]" />
                  {team.name}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push(createTeamHref())}>
          {t("createTeam")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push(joinTeamHref())}>
          {t("joinByCode")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
