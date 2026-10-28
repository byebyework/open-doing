import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { SpaceNav } from "@/components/layout/SpaceNav";
import { getSpaceNavData } from "@/components/layout/SpaceNavData";
import { requireUser } from "@/features/auth/session";

/**
 * 应用内路由布局（F-5 冻结外壳 + F-6 会话接入）。
 *
 * v1.1 M2 契约变更（2026-10-28）：原 PersonalNav / TeamsNav 双槽合并为统一
 * `SpaceNav`；导航数据由 `getSpaceNavData()` 一次取齐，移动端同源复用。
 * 未登录访问任一 `(dashboard)` 路由时由 `requireUser()` 重定向到 /login。
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [user, navData] = await Promise.all([
    requireUser(),
    getSpaceNavData(),
  ]);

  return (
    <AppShell
      nav={<SpaceNav data={navData} />}
      mobileNav={null}
      user={user}
    >
      {children}
    </AppShell>
  );
}
