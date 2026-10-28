import type { User } from "@open-doing/types";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * AppShell 入参（F-5 冻结契约；v1.1 M2 契约变更 2026-10-28：
 * 原 `personalNav` / `teamsNav` 双槽合并为单一 `nav`，并新增 `mobileNav`）。
 */
export interface AppShellProps {
  /** 桌面侧栏导航段（固定传 `<SpaceNav data={...} />`）。 */
  nav: ReactNode;
  /** 移动端导航入口（Task 6 接入 `<MobileNav />`；接入前传 null）。 */
  mobileNav: ReactNode;
  /** 当前登录用户。 */
  user: User | null;
  /** 页面内容。 */
  children: ReactNode;
}

/**
 * 应用外壳：左侧栏 + 顶栏 + 内容区。
 *
 * 布局冻结：业务轨道只能替换 `nav` / `mobileNav` 的实现，
 * 不得修改本组件或 `(dashboard)/layout.tsx` 的导入关系。
 */
export function AppShell({ nav, mobileNav, user, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[#f4f5f7] text-[#0e1318]">
      <Sidebar nav={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} mobileNav={mobileNav} />
        <main className="min-w-0 flex-1 px-4 py-6 min-[861px]:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
