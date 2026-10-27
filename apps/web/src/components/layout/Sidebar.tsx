import Link from "next/link";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/features/auth/session";
import { listTeamsForUser } from "@/features/teams/service";

import { SpaceSwitcher } from "./SpaceSwitcher";

/** Sidebar 入参。 */
export interface SidebarProps {
  /** 个人空间导航段（由 PersonalNav 桩渲染）。 */
  personalNav: ReactNode;
  /** 团队空间导航段（由 TeamsNav 桩渲染）。 */
  teamsNav: ReactNode;
}

/**
 * 应用左侧栏：Logo + 空间切换器 + 两段导航。
 *
 * 本组件为 server component：读取当前用户及其团队，把可序列化的团队
 * `{ slug, name }` 交给 `SpaceSwitcher` 渲染真实切换菜单。
 * 两段导航的内容与分组标题均由各自的桩组件（PersonalNav / TeamsNav）负责，
 * 本组件只提供顺序与滚动容器，保证后续轨道无需改动布局。
 * ≤860px 整体隐藏（v1 桌面优先）。
 */
export async function Sidebar({ personalNav, teamsNav }: SidebarProps) {
  const user = await getCurrentUser();
  const teams = user ? await listTeamsForUser(user.id) : [];

  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col gap-2 border-r border-[#e1e3e6] bg-white px-3 py-4 min-[861px]:flex">
      {/* 品牌区 */}
      <Link
        href="/my"
        className="mb-2 flex items-center gap-2.5 px-3 py-2 text-[#0e1318] no-underline hover:text-[#0e1318]"
      >
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[16px] font-extrabold text-white shadow-[0_2px_8px_rgba(125,42,232,0.2)]">
          O
        </span>
        <span className="text-[15px] font-extrabold tracking-[-0.01em]">
          Open Doing
        </span>
      </Link>

      {/* 空间切换器：团队列表由服务端取数，交互在 client 组件内 */}
      <SpaceSwitcher teams={teams.map(({ slug, name }) => ({ slug, name }))} />

      {/* 导航区：两段顺序固定，内容由桩文件接管 */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {personalNav}
        {teamsNav}
      </nav>
    </aside>
  );
}
