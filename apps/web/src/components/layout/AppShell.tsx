import type { User } from "@open-doing/types";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/** AppShell 入参（F-5 冻结契约，后续轨道只消费、不改本组件）。 */
export interface AppShellProps {
  /** 个人空间导航段（固定传 `<PersonalNav />`）。 */
  personalNav: ReactNode;
  /** 团队空间导航段（固定传 `<TeamsNav />`）。 */
  teamsNav: ReactNode;
  /** 当前登录用户；F-6 接入会话前传 null。 */
  user: User | null;
  /** 页面内容。 */
  children: ReactNode;
}

/**
 * 应用外壳：左侧栏 + 顶栏 + 内容区。
 *
 * 布局冻结后，业务轨道只能替换导航桩（PersonalNav / TeamsNav）的实现，
 * 不得修改本组件或 `(dashboard)/layout.tsx` 的导入关系。
 */
export function AppShell({
  personalNav,
  teamsNav,
  user,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[#f4f5f7] text-[#0e1318]">
      <Sidebar personalNav={personalNav} teamsNav={teamsNav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="min-w-0 flex-1 px-4 py-6 min-[861px]:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
