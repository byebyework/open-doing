import type { ReactNode } from "react";

import { AdminSidebar } from "@/features/admin/components/admin-sidebar";
import { requireAdmin } from "@/features/admin/guard";

/**
 * 管理控制台独立布局（`/admin/**`）。
 *
 * 与 `(dashboard)` 的 AppShell / `(dashboard)/layout.tsx` 完全解耦：
 * 左侧是管理侧栏（品牌 + 三模块 + 返回业务区 + 管理员用户条），
 * 右侧是内容区；网格列宽取 `--sidebar-width`。入口守卫在布局层执行
 * `requireAdmin()`：未登录 -> /login，非管理员 -> 个人仪表盘。
 * 布局层只负责可达性；每个管理 Server Action 仍自行鉴权。
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--ink-900)] min-[861px]:grid min-[861px]:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
      <AdminSidebar user={user} />
      <main className="min-w-0 px-4 py-6 min-[861px]:px-6">{children}</main>
    </div>
  );
}
