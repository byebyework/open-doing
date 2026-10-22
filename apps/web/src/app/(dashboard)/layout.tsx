import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { PersonalNav } from "@/features/personal/components/PersonalNav";
import { TeamsNav } from "@/features/teams/components/TeamsNav";

/**
 * 应用内路由布局（F-5 冻结）。
 *
 * 只 import 两个固定导航桩；P/T 轨道通过替换桩文件接入导航，
 * 不得修改本文件。F-6 在此接入 `requireUser()` 并把用户传给 AppShell。
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AppShell
      personalNav={<PersonalNav />}
      teamsNav={<TeamsNav />}
      user={null}
    >
      {children}
    </AppShell>
  );
}
