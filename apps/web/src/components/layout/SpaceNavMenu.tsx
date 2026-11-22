"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, ReactNode } from "react";

import {
  invitesHref,
  isSpacePathname,
  moduleHref,
  resolveAmbientSpaceRef,
  type SpaceModule,
} from "@/lib/routes";

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
  "bg-[var(--purple-08)] font-semibold text-[var(--purple-600)]";

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

/** 任务图标（勾选方块列表，模块改名后沿用同粗细线稿）。 */
function TasksIcon() {
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
      <rect x="3.5" y="4.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="7" rx="1.5" />
      <path d="M14 6.5h6.5M14 16.5h6.5" />
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

/** Moments 图标（表盘 + 指针，对齐原型分节 A 侧栏「时刻」）。 */
function MomentsIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
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

/** 管理控制台图标（盾牌，权限语义）。 */
function AdminConsoleIcon() {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** 关于系统图标（圆圈 i，信息语义）。 */
function AboutSystemIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

/** 导航项：模块 + i18n 标签 key + 图标（顺序与原型侧栏一致）。 */
interface SpaceNavModule {
  module: SpaceModule;
  labelKey:
    | "dashboard"
    | "projects"
    | "tasks"
    | "calendar"
    | "moments"
    | "analysis"
    | "tags"
    | "teamManagement";
  Icon: ComponentType;
}

/** 项目模块图标（对齐原型 folder icon，v1.2 新增模块）。 */
function ProjectsIcon() {
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
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/**
 * 个人空间六模块：「时刻」为个人空间专属（不进团队导航），
 * 排在 Calendar 与 Analysis 之间（时间语义相邻）；
 * 个人设置已上移为系统级 `/settings`，不再出现在空间导航。
 */
/** 标签模块图标（对齐原型 tag icon）。 */
function TagsIcon() {
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
      <path d="M3 10V5a2 2 0 0 1 2-2h5l11 11-7 7L3 10z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}

const PERSONAL_MODULES: SpaceNavModule[] = [
  { module: "dashboard", labelKey: "dashboard", Icon: DashboardIcon },
  { module: "projects", labelKey: "projects", Icon: ProjectsIcon },
  { module: "tasks", labelKey: "tasks", Icon: TasksIcon },
  { module: "calendar", labelKey: "calendar", Icon: CalendarIcon },
  { module: "moments", labelKey: "moments", Icon: MomentsIcon },
  { module: "analysis", labelKey: "analysis", Icon: AnalysisIcon },
  { module: "tags", labelKey: "tags", Icon: TagsIcon },
];

/**
 * 团队空间六模块：显式枚举而非展开 `PERSONAL_MODULES`——
 * `moments` 为个人空间专属，展开写法会让它泄漏进团队侧栏；
 * 末项「团队管理」沿用团队 settings 路由（路径不变）。
 */
const TEAM_MODULES: SpaceNavModule[] = [
  { module: "dashboard", labelKey: "dashboard", Icon: DashboardIcon },
  { module: "projects", labelKey: "projects", Icon: ProjectsIcon },
  { module: "tasks", labelKey: "tasks", Icon: TasksIcon },
  { module: "calendar", labelKey: "calendar", Icon: CalendarIcon },
  { module: "analysis", labelKey: "analysis", Icon: AnalysisIcon },
  { module: "tags", labelKey: "tags", Icon: TagsIcon },
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
 * 非空间路由（如 `/invites`、`/teams/new`）回退 `{ spaceRef: "personal",
 * module: null }`——系统页的上下文由链接携带的 `?space=` 参数在组件内
 * 单独解析（见 SpaceNavMenu），本函数保持纯路径语义。
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
 * - 当前空间名作为分组标题；个人空间 6 项（Dashboard / 项目 / 任务 /
 *   Calendar / 时刻 / Analysis，v1.2 新增「项目」，「时刻」为
 *   个人空间专属），团队空间不含「时刻」，额外第 6 项「团队管理」
 *   （团队的 settings 路由）；
 * - 「账号」分组待处理邀请入口，pending 数 > 0 时显示红色角标；
 * - 未登录（`data.loggedIn === false`）整体不渲染。
 */
export function SpaceNavMenu({ data }: SpaceNavMenuProps) {
  // hook 必须在任何提前 return 之前无条件调用。
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("nav");

  if (!data.loggedIn) return null;

  const { spaceRef: pathnameSpace, module: activeModule } =
    resolveSpaceLocation(pathname);
  // 系统页（/about、/invites）的空间上下文由链接携带的 ?space= 参数解析，
  // 经白名单校验（不信任 URL 输入）；空间路由以 pathname 为准。
  // cookie 方案在多标签页下会互相覆盖（cookie 是浏览器全局的），URL 携带
  // 上下文天然按导航隔离。
  const urlSpace = resolveAmbientSpaceRef(
    searchParams.get("space"),
    data.teams.map((team) => team.slug),
  );
  const spaceRef = isSpacePathname(pathname)
    ? pathnameSpace
    : (urlSpace ?? "personal");
  // 个人空间 6 项、团队空间 6 项；未知 slug 按团队渲染（团队管理路由仍可 404）。
  const modules = spaceRef === "personal" ? PERSONAL_MODULES : TEAM_MODULES;
  const spaceLabel = resolveSpaceLabel(spaceRef, data.teams) ?? t("personalSpace");
  const systemLinkSpace = encodeURIComponent(spaceRef);
  const invitesActive =
    pathname === invitesHref() || pathname.startsWith(`${invitesHref()}/`);
  // 管理控制台独立于业务 Space 体系，active 判定直接按 /admin 前缀。
  const adminActive = pathname === "/admin" || pathname.startsWith("/admin/");
  const aboutActive = pathname === "/about" || pathname.startsWith("/about/");

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
          href={`${invitesHref()}?space=${systemLinkSpace}`}
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
                className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[var(--status-overdue)] px-1 text-[11px] font-bold text-white group-data-[collapsed]/sidebar:absolute group-data-[collapsed]/sidebar:left-1/2 group-data-[collapsed]/sidebar:top-1 group-data-[collapsed]/sidebar:ml-[3px] group-data-[collapsed]/sidebar:h-[7px] group-data-[collapsed]/sidebar:min-w-0 group-data-[collapsed]/sidebar:p-0 group-data-[collapsed]/sidebar:text-[0px]"
              >
                {data.pendingInviteCount}
              </span>
            ) : null}
          </NavLinkBody>
        </Link>
        {/* 管理控制台入口：仅系统管理员可见（服务端数据判定，普通用户拿不到 DOM）。 */}
        {data.isAdmin ? (
          <Link
            href="/admin"
            aria-current={adminActive ? "page" : undefined}
            title={t("adminConsole")}
            className={`${NAV_ITEM_BASE} ${
              adminActive ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
            }`}
          >
            <NavLinkBody>
              <AdminConsoleIcon />
              <span className={NAV_LABEL_CLASS}>{t("adminConsole")}</span>
            </NavLinkBody>
          </Link>
        ) : null}
        {/* 关于系统入口：所有登录用户可见。 */}
        <Link
          href={`/about?space=${systemLinkSpace}`}
          aria-current={aboutActive ? "page" : undefined}
          title={t("aboutSystem")}
          className={`${NAV_ITEM_BASE} ${
            aboutActive ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE
          }`}
        >
          <NavLinkBody>
            <AboutSystemIcon />
            <span className={NAV_LABEL_CLASS}>{t("aboutSystem")}</span>
          </NavLinkBody>
        </Link>
      </div>
    </>
  );
}
