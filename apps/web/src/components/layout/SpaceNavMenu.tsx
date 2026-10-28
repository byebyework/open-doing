"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { invitesHref, moduleHref, type SpaceModule } from "@/lib/routes";

import type { SpaceNavData } from "./SpaceNavData";

/** 导航项基础样式：与原型 `.nav-item` 对齐（8px 12px、8px 圆角、13.5px）。 */
const NAV_ITEM_BASE =
  "flex items-center gap-[10px] rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors";

/** 未选中态：次要文字色，hover 用浅灰表面。 */
const NAV_ITEM_IDLE =
  "text-[#3c4043] hover:bg-[#f4f5f7] hover:text-[#0e1318]";

/** 当前路由态：品牌紫文字 + 8% 紫底（原型 `.nav-item.active`）。 */
const NAV_ITEM_ACTIVE =
  "bg-[rgba(125,42,232,0.08)] font-semibold text-[#7d2ae8]";

/** 分组标题：与原型 `.nav-group-label` 一致。 */
const NAV_GROUP_LABEL =
  "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]";

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

/** 当前空间五模块（顺序与原型侧栏一致）。 */
const MODULES: { module: SpaceModule; label: string; Icon: ComponentType }[] = [
  { module: "dashboard", label: "Dashboard", Icon: DashboardIcon },
  { module: "kanban", label: "Kanban", Icon: KanbanIcon },
  { module: "calendar", label: "Calendar", Icon: CalendarIcon },
  { module: "analysis", label: "Analysis", Icon: AnalysisIcon },
  { module: "settings", label: "设置", Icon: SettingsIcon },
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

/** 当前空间显示名：个人空间固定文案，团队取团队名，未知 slug 回退个人空间语义。 */
export function resolveSpaceLabel(
  spaceRef: string,
  teams: SpaceNavData["teams"],
): string {
  if (spaceRef === "personal") return "个人空间";
  return teams.find((team) => team.slug === spaceRef)?.name ?? "个人空间";
}

/**
 * 统一空间导航菜单（v1.1 M2 新 IA）。
 *
 * 结构对照原型 `space-dashboard-*.html` 侧栏：
 * - 当前空间名作为分组标题，下挂 Dashboard / Kanban / Calendar / Analysis / 设置；
 * - 「账号」分组待处理邀请入口，pending 数 > 0 时显示红色角标；
 * - 未登录（`data.loggedIn === false`）整体不渲染。
 */
export function SpaceNavMenu({ data }: SpaceNavMenuProps) {
  // hook 必须在任何提前 return 之前无条件调用。
  const pathname = usePathname();

  if (!data.loggedIn) return null;

  const { spaceRef, module: activeModule } = resolveSpaceLocation(pathname);
  const spaceLabel = resolveSpaceLabel(spaceRef, data.teams);
  const invitesActive =
    pathname === invitesHref() || pathname.startsWith(`${invitesHref()}/`);

  return (
    <>
      <div className="flex flex-col">
        <div className={NAV_GROUP_LABEL}>{spaceLabel}</div>
        {MODULES.map(({ module, label, Icon }) => {
          const active = activeModule === module;

          return (
            <Link
              key={module}
              href={moduleHref(spaceRef, module)}
              aria-current={active ? "page" : undefined}
              className={`${NAV_ITEM_BASE} ${
                active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
              }`}
            >
              <Icon />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col">
        <div className={NAV_GROUP_LABEL}>账号</div>
        <Link
          href={invitesHref()}
          aria-current={invitesActive ? "page" : undefined}
          className={`${NAV_ITEM_BASE} ${
            invitesActive ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
          }`}
        >
          <InvitesIcon />
          <span className="min-w-0 flex-1">待处理邀请</span>
          {data.pendingInviteCount > 0 ? (
            <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[#ff5757] px-1 text-[11px] font-bold text-white">
              {data.pendingInviteCount}
            </span>
          ) : null}
        </Link>
      </div>
    </>
  );
}
