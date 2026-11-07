import Link from "next/link";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/features/auth/session";
import { listTeamsForUser } from "@/features/teams/service";
import { spaceDashboardHref } from "@/lib/routes";

import { SidebarShell } from "./SidebarShell";
import { SpaceSwitcher } from "./SpaceSwitcher";

/** Sidebar 入参。 */
export interface SidebarProps {
  /** 当前空间导航段（由 `<SpaceNav />` 渲染）。 */
  nav: ReactNode;
}

/**
 * 应用左侧栏：Logo + 空间切换器 + 当前空间导航。
 *
 * 本组件为 server component：读取当前用户及其团队，把可序列化的团队
 * `{ slug, name }` 交给 `SpaceSwitcher` 渲染真实切换菜单。
 * 导航内容（当前空间模块 + 账号分组）由 `SpaceNav` 负责，
 * 本组件只提供顺序与滚动容器。
 * ≤860px 整体隐藏（移动端入口由 `MobileNav` 提供）。
 * 伸缩（展开 232px / 收起 68px 图标栏）由 `SidebarShell` 提供：
 * aside 元素与收起状态在 client 壳上，本组件只渲染壳内内容。
 */
export async function Sidebar({ nav }: SidebarProps) {
  const user = await getCurrentUser();
  const teams = user ? await listTeamsForUser(user.id) : [];

  return (
    <SidebarShell>
      {/* 品牌区：收起态只留渐变 mark，居中 */}
      <Link
        href={spaceDashboardHref("personal")}
        className="mb-2 flex items-center gap-2.5 px-3 py-2 text-[var(--ink-900)] no-underline hover:text-[var(--ink-900)] group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:px-0"
      >
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[16px] font-extrabold text-white shadow-[0_2px_8px_rgba(125,42,232,0.2)]">
          O
        </span>
        <span className="text-[15px] font-extrabold tracking-[-0.01em] group-data-[collapsed]/sidebar:hidden">
          Open Doing
        </span>
      </Link>

      {/* 空间切换器：团队列表由服务端取数，交互在 client 组件内 */}
      <SpaceSwitcher teams={teams.map(({ slug, name }) => ({ slug, name }))} />

      {/* 当前空间导航 */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {nav}
      </nav>
    </SidebarShell>
  );
}
