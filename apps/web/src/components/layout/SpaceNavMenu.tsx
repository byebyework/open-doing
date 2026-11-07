"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, ReactNode } from "react";

import { invitesHref, moduleHref, type SpaceModule } from "@/lib/routes";

import type { SpaceNavData } from "./SpaceNavData";

/**
 * 导航项基础样式：与原型 `.nav-item` 对齐（8px 12px、8px 圆角、13.5px）。
 * 侧栏收起态（`SidebarShell` 的 `data-collapsed`）下隐藏文字、图标居中。
 */
const NAV_ITEM_BASE =
  "relative flex items-center gap-[10px] rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:px-0";

/** 未选中态：次要文字色，hover 用浅灰表面。 */
const NAV_ITEM_IDLE =
  "text-[#3c4043] hover:bg-[#f4f5f7] hover:text-[var(--ink-900)]";

/** 当前路由态：品牌紫文字 + 8% 紫底（原型 `.nav-item.active`）。 */
const NAV_ITEM_ACTIVE =
  "bg-[rgba(125,42,232,0.08)] font-semibold text-[#7d2ae8]";

/** 分组标题：与原型 `.nav-group-label` 一致（收起态整体隐藏）。 */
const NAV_GROUP_LABEL =
  "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ink-400)] group-data-[collapsed]/sidebar:hidden";

/** 导航项文字：收起态隐藏（图标即全部信息，全称走 title）。 */
const NAV_LABEL_CLASS = "min-w-0 group-data-[collapsed]/sidebar:hidden";

/**
 * 导航项内容包装：消费 `useLinkStatus` 的 pending 态（RSC 取数期间），
 * 整行降透明度作为导航进行中的反馈——路由无 loading.js 时 App Router
 * 会一直停留在旧页面，没有这个信号点击就像「没反应」。
 * 固定结构性元素（不改尺寸、不加 spinner），只在 pending 时降透明度，
 * 避免布局位移；prefetch 命中时 pending 被跳过，不会闪。
 */
function NavLinkBody({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-busy={pending || undefined}
      className={`flex min-w-0 flex-1 items-center gap-[10px] transition-opacity duration-150 group-data-[collapsed]/sidebar:flex-none ${
        pending ? "opacity-50" : "opacity-100"
      }`}
    >
      {children}
    </span>
  );
}

/** 图标样式：17px、跟随文字色、原型 0.85 透明度。 */
const ICON_CLASS = "h-[17px] w-[17px] shrink-0 opacity-[0.85]";

/** Dashboard 图标（原型折线图）。 */
function DashboardIcon() {
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

/** Kanban 图标（原型三列看板）。 */
function KanbanIcon() {
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
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="4" height="8" rx="1" />
    </svg>
  );
}

/** Calendar 图标（原型日历）。 */
function CalendarIcon() {
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
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

/** Analysis 图标（原型饼图）。 */
function AnalysisIcon() {
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
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

/** 设置图标（原型齿轮）。 */
function SettingsIcon() {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.15.35.23.72.23 1.09" />
    </svg>
  );
}

/** 待处理邀请图标（原型用户 + 加号）。 */
function InvitesIcon() {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

/** 导航项：模块 + i18n 标签 key + 图标（顺序与原型侧栏一致）。 */
interface SpaceNavModule {
  module: SpaceModule;
  labelKey: "dashboard" | "kanban" | "calendar" | "analysis" | "teamManagement";
  Icon: ComponentType;
}

/** 个人空间四模块：个人设置已上移为系统级 `/settings`，不再出现在空间导航。 */
const PERSONAL_MODULES: SpaceNavModule[] = [
  { module: "dashboard", labelKey: "dashboard", Icon: DashboardIcon },
  { module: "kanban", labelKey: "kanban", Icon: KanbanIcon },
  { module: "calendar", labelKey: "calendar", Icon: CalendarIcon },
  { module: "analysis", labelKey: "analysis", Icon: AnalysisIcon },
];

/** 团队空间五模块：末项「团队管理」沿用团队 settings 路由（路径不变）。 */
const TEAM_MODULES: SpaceNavModule[] = [
  ...PERSONAL_MODULES,
  { module: "settings", labelKey: "teamManagement", Icon: SettingsIcon },
];

/** SpaceNavMenu 入参。 */
export interface SpaceNavMenuProps {
  /** 布局层一次性取好的导航数据。 */
  data: SpaceNavData;
}

/**
 * 当前空间解析结果。
 *
 * `/space/{spaceRef}/{module}` 取第二段为空间、第三段为模块；
 * 非空间路由（如 `/invites`、`/teams/new`）回退到个人空间且不高亮模块。
 */
export function resolveSpaceLocation(pathname: string): {
  spaceRef: string;
  module: string | null;
} {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "space" || !segments[1]) {
    return { spaceRef: "personal", module: null };
  }
  return { spaceRef: segments[1], module: segments[2] ?? null };
}

/**
 * 当前空间显示名：团队取团队名；个人空间与未知 slug 返回 null，
 * 由调用方用 `nav.personalSpace` 翻译兜底（本函数保持纯函数、不依赖 hook）。
 */
export function resolveSpaceLabel(
  spaceRef: string,
  teams: SpaceNavData["teams"],
): string | null {
  if (spaceRef === "personal") return null;
  return teams.find((team) => team.slug === spaceRef)?.name ?? null;
}

/**
 * 统一空间导航菜单（v1.1 M2 新 IA）。
 *
 * 结构对照原型 `space-dashboard-*.html` 侧栏：
 * - 当前空间名作为分组标题；个人空间 4 项（Dashboard / Kanban / Calendar /
 *   Analysis），团队空间额外第 5 项「团队管理」（团队的 settings 路由）；
 * - 「账号」分组待处理邀请入口，pending 数 > 0 时显示红色角标；
 * - 未登录（`data.loggedIn === false`）整体不渲染。
 */
export function SpaceNavMenu({ data }: SpaceNavMenuProps) {
  // hook 必须在任何提前 return 之前无条件调用。
  const pathname = usePathname();
  const t = useTranslations("nav");

  if (!data.loggedIn) return null;

  const { spaceRef, module: activeModule } = resolveSpaceLocation(pathname);
  // 个人空间 4 项、团队空间 5 项；未知 slug 按团队渲染（团队管理路由仍可 404）。
  const modules = spaceRef === "personal" ? PERSONAL_MODULES : TEAM_MODULES;
  const spaceLabel = resolveSpaceLabel(spaceRef, data.teams) ?? t("personalSpace");
  const invitesActive =
    pathname === invitesHref() || pathname.startsWith(`${invitesHref()}/`);

  return (
    <>
      <div className="flex flex-col">
        <div className={NAV_GROUP_LABEL}>{spaceLabel}</div>
        {modules.map(({ module, labelKey, Icon }) => {
          const active = activeModule === module;

          return (
            <Link
              key={module}
              href={moduleHref(spaceRef, module)}
              aria-current={active ? "page" : undefined}
              title={t(labelKey)}
              className={`${NAV_ITEM_BASE} ${
                active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
              }`}
            >
              <NavLinkBody>
                <Icon />
                <span className={NAV_LABEL_CLASS}>{t(labelKey)}</span>
              </NavLinkBody>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col">
        <div className={NAV_GROUP_LABEL}>{t("accountGroup")}</div>
        <Link
          href={invitesHref()}
          aria-current={invitesActive ? "page" : undefined}
          title={t("pendingInvites")}
          className={`${NAV_ITEM_BASE} ${
            invitesActive ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
          }`}
        >
          <NavLinkBody>
            <InvitesIcon />
            <span className={`flex-1 ${NAV_LABEL_CLASS}`}>
              {t("pendingInvites")}
            </span>
            {data.pendingInviteCount > 0 ? (
              // 收起态：数字徽标缩为图标右上角的 7px 红点（数量走 title）。
              <span
                title={data.pendingInviteCount.toString()}
                className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[#ff5757] px-1 text-[11px] font-bold text-white group-data-[collapsed]/sidebar:absolute group-data-[collapsed]/sidebar:left-1/2 group-data-[collapsed]/sidebar:top-1 group-data-[collapsed]/sidebar:ml-[3px] group-data-[collapsed]/sidebar:h-[7px] group-data-[collapsed]/sidebar:min-w-0 group-data-[collapsed]/sidebar:p-0 group-data-[collapsed]/sidebar:text-[0px]"
              >
                {data.pendingInviteCount}
              </span>
            ) : null}
          </NavLinkBody>
        </Link>
      </div>
    </>
  );
}
