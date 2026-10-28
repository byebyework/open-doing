import { redirect } from "next/navigation";

/**
 * 应用首页：统一重定向到「我的任务」。
 *
 * 路由组 `(dashboard)` 不产生 URL 段，因此本文件对应 `/`。
 */
export default function DashboardHomePage() {
  redirect("/space/personal/dashboard");
}
