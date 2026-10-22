import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { requireUser } from "@/features/auth/session";
import { PersonalNav } from "@/features/personal/components/PersonalNav";
import { TeamsNav } from "@/features/teams/components/TeamsNav";

/**
 * 应用内路由布局（F-5 冻结外壳 + F-6 会话接入）。
 *
 * 只 import 两个固定导航桩；P/T 轨道通过替换桩文件接入导航。
 * 未登录访问任一 `(dashboard)` 路由时由 `requireUser()` 重定向到 /login。
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();

  return (
    <AppShell
      personalNav={<PersonalNav />}
      teamsNav={<TeamsNav />}
      user={user}
    >
      {children}
    </AppShell>
  );
}
