import { displayName, type User } from "@open-doing/types";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandMark } from "@/components/ui/BrandMark";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/shadcn/badge";
import { spaceDashboardHref } from "@/lib/routes";

import { AdminNav } from "./admin-nav";

/** 品牌区与用户条共用的侧栏链接样式。 */
const BRAND_LINK =
  "flex items-center gap-2.5 rounded-[var(--radius-8)] px-3 py-2 text-[var(--ink-900)] no-underline hover:text-[var(--ink-900)]";

/** 导航项基础样式（与 client 导航保持一致）。 */
const NAV_ITEM =
  "flex items-center gap-[10px] rounded-[var(--radius-8)] px-3 py-2 text-[13.5px] font-medium no-underline text-[var(--ink-700)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--ink-900)]";

/**
 * 管理控制台独立侧栏（RSC，纯导航）。
 *
 * 与业务侧栏结构对齐（品牌 + 模块导航 + 返回业务区 + 用户条），但不复用
 * `(dashboard)` 的 AppShell / SpaceNav —— 管理台是凌驾于各 Space 之上的
 * 独立布局。仅「当前路由高亮」下放到 client 的 `AdminNav`，其余保持 RSC。
 * ≤860px 与业务侧栏一致整体隐藏，内容区单列铺满。
 */
export async function AdminSidebar({ user }: { user: User }) {
  const t = await getTranslations("admin");

  return (
    <aside className="sticky top-0 hidden h-screen w-[var(--sidebar-width)] flex-col gap-2 self-start border-r border-[var(--border-default)] bg-[var(--card)] px-3 py-4 min-[861px]:flex">
      <Link href="/admin" className={BRAND_LINK}>
        <BrandMark className="h-[30px] w-[30px] shrink-0" />
        <span className="text-[15px] font-extrabold tracking-[-0.01em]">
          Open Doing
        </span>
      </Link>

      <div>
        <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-400)]">
          {t("consoleTitle")}
        </div>
        <AdminNav />
      </div>

      <div className="mt-auto">
        <Link href={spaceDashboardHref("personal")} className={NAV_ITEM}>
          <svg
            className="h-[17px] w-[17px] shrink-0 opacity-[0.85]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          <span className="min-w-0">{t("backToWorkspace")}</span>
        </Link>

        <div className="mt-2 flex items-center gap-2.5 border-t border-[var(--border-default)] px-3 pt-3">
          <UserAvatar userId={user.id} name={displayName(user)} size={30} />
          <div className="min-w-0 leading-[1.25]">
            <div className="truncate text-[13px] font-semibold text-[var(--ink-900)]">
              {displayName(user)}
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--ink-400)]">
              {user.uid}
            </div>
          </div>
          <Badge
            variant="neutral"
            className="ml-auto rounded-[var(--radius-pill)] bg-[var(--primary-bg)] px-2 py-0 text-[12px] font-semibold text-[var(--purple-600)]"
          >
            {t("roleAdmin")}
          </Badge>
        </div>
      </div>
    </aside>
  );
}
