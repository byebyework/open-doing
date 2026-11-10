import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/session";
import { LandingPage } from "@/features/landing/components/LandingPage";
import { spaceDashboardHref } from "@/lib/routes";

/**
 * 根路由 `/`：已登录进入个人空间仪表盘，未登录展示落地页。
 *
 * 重定向职责从冻结的 `(dashboard)` 路由组移到本文件；`(dashboard)/layout.tsx`
 * 及其 import 关系保持不变。`getCurrentUser()` 只返回用户或 null，不自行
 * 跳转，因此这里显式判断。
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");

  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) redirect(spaceDashboardHref("personal"));

  return <LandingPage />;
}
