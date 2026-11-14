"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/** 图标样式：与业务侧栏一致（17px、跟随文字色、0.85 透明度）。 */
const ICON_CLASS = "h-[17px] w-[17px] shrink-0 opacity-[0.85]";

/** 导航项基础样式（原型 `.nav-item`：8px 12px、8px 圆角、13.5px）。 */
const NAV_ITEM_BASE =
  "flex items-center gap-[10px] rounded-[var(--radius-8)] px-3 py-2 text-[13.5px] font-medium no-underline transition-colors";

/** 未选中态：次要文字色，hover 用浅灰表面。 */
const NAV_ITEM_IDLE =
  "text-[var(--ink-700)] hover:bg-[var(--muted)] hover:text-[var(--ink-900)]";

/** 当前路由态：品牌紫文字 + 8% 紫底（原型 `.nav-item.active`）。 */
const NAV_ITEM_ACTIVE =
  "bg-[var(--primary-bg)] font-semibold text-[var(--purple-600)]";

/** 概览图标（折线图，与业务 Dashboard 同款）。 */
function OverviewIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}

/** 注册码图标（原型钥匙）。 */
function CodesIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

/** 用户图标（原型双人像）。 */
function UsersIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** 管理台三模块（顺序与原型一致）。 */
const NAV_ITEMS = [
  { href: "/admin", labelKey: "navOverview", icon: OverviewIcon },
  {
    href: "/admin/registration-codes",
    labelKey: "navRegistrationCodes",
    icon: CodesIcon,
  },
  { href: "/admin/users", labelKey: "navUsers", icon: UsersIcon },
] as const;

/**
 * 管理侧栏导航（client，仅负责路由高亮）。
 *
 * 概览要求精确匹配（`/admin`），其余模块匹配自身及其子路由
 * （如 `/admin/users/[userId]` 仍高亮「用户管理」）。文案取自
 * `admin` 命名空间，布局其余部分保持 RSC。
 */
export function AdminNav() {
  const t = useTranslations("admin");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
        const active =
          href === "/admin"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${NAV_ITEM_BASE} ${active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE}`}
          >
            <Icon />
            <span className="min-w-0">{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
