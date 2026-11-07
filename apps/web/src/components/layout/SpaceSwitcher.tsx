"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

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
  // 空间切换是 RSC 重取数（目标路由无 loading.js），用 transition 标记
  // pending：旧页面保持可见，触发器降透明度作为「正在切换」的反馈。
  const [switchPending, startSwitchTransition] = useTransition();

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
          title={currentLabel}
          className={`mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-2 text-left text-[13px] transition-[color,background-color,border-color,opacity] duration-150 hover:border-[#c7cdd3] hover:bg-[#f4f5f7] group-data-[collapsed]/sidebar:mx-0 group-data-[collapsed]/sidebar:w-full group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:px-0 ${
            switchPending ? "opacity-50" : ""
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#7d2ae8]" />
          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--ink-900)] group-data-[collapsed]/sidebar:hidden">
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
            className="shrink-0 text-[var(--ink-400)] group-data-[collapsed]/sidebar:hidden"
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
          onSelect={() =>
            startSwitchTransition(() =>
              router.push(spaceDashboardHref("personal")),
            )
          }
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
                onSelect={() =>
                  startSwitchTransition(() =>
                    router.push(spaceDashboardHref(team.slug)),
                  )
                }
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
        <DropdownMenuItem
          onSelect={() =>
            startSwitchTransition(() => router.push(createTeamHref()))
          }
        >
          {t("createTeam")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            startSwitchTransition(() => router.push(joinTeamHref()))
          }
        >
          {t("joinByCode")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
