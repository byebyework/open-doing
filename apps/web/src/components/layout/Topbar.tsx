"use client";

import { displayName, type User } from "@open-doing/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { logoutAction } from "@/features/auth/actions";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { personalSettingsHref } from "@/lib/routes";

import {
  toggleSidebarCollapsed,
  useSidebarCollapsed,
} from "./SidebarShell";

/** 个人设置图标（齿轮，与空间导航的同款图标一致）。 */
function SettingsIcon() {
  return (
    <svg
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

/** 退出登录图标（原型 log-out：门 + 外指箭头，与齿轮同款描边风格）。 */
function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/** Topbar 入参。 */
export interface TopbarProps {
  /** 当前登录用户；F-6 接入会话前为 null（此时展示中性占位头像）。 */
  user: User | null;
  /** 移动端导航入口（Task 6 接入 `<MobileNav />`），渲染在品牌标记之前。 */
  mobileNav?: ReactNode;
}

/**
 * 顶栏：侧栏伸缩按钮 + 品牌/面包屑位 + 通知占位 + 用户头像。
 *
 * `<NotificationBell />` 当前渲染 null，N-2 在原路径替换实现；
 * 搜索框暂不实现（功能接线前整体移除，避免占位误导）。
 */
export function Topbar({ user, mobileNav }: TopbarProps) {
  const router = useRouter();
  const t = useTranslations("nav");
  const [loggingOut, setLoggingOut] = useState(false);
  const sidebarCollapsed = useSidebarCollapsed();

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    try {
      const result = await logoutAction();
      if (result.ok) {
        router.push("/login");
        router.refresh();
      }
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-[var(--border-default)] bg-[rgba(255,255,255,0.85)] px-4 backdrop-blur min-[861px]:gap-4 min-[861px]:px-6">
      {/* 移动端导航入口（<861px 显示，由 MobileNav 负责） */}
      {mobileNav}

      {/* 桌面侧栏伸缩按钮（≤860px 无侧栏，随侧栏一并隐藏）；ghost 样式，
          hover 才显形，避免在扁平顶栏里突兀。 */}
      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        aria-expanded={!sidebarCollapsed}
        aria-label={
          sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")
        }
        title={sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
        className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink-500)] transition-colors duration-150 hover:bg-[#f4f5f7] hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)] min-[861px]:inline-flex"
      >
        {/* 面板折叠图标：外框 + 左分隔线 + chevron（收起时朝右） */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <path d="M9 4.5v15" />
          {sidebarCollapsed ? (
            <path d="M12.5 10l2.5 2-2.5 2" />
          ) : (
            <path d="M14.5 10L12 12l2.5 2" />
          )}
        </svg>
      </button>

      {/* 品牌标识仅移动端保留（<861px 无侧栏）；桌面端侧栏已有品牌区，
          顶栏重复展示信息冗余。 */}
      <span
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-[image:var(--brand-gradient)] text-[14px] font-extrabold text-white min-[861px]:hidden"
        aria-hidden="true"
      >
        O
      </span>
      <div className="min-[861px]:hidden truncate text-[13px] text-[var(--ink-500)]">
        Open Doing
      </div>

      {/* 通知入口占位（N-2 替换实现）+ 右侧用户区：占位当前渲染 null，
          由本容器承担把用户头像推到右端（原为搜索框 ml-auto）。 */}
      <div className="ml-auto flex items-center">
        <NotificationBell />
      </div>

      {/* 用户头像区：点击打开用户菜单（个人设置 / 退出登录） */}
      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={loggingOut}>
            <button
              type="button"
              data-testid="user-menu-button"
              aria-label={t("currentUserAria", { name: displayName(user) })}
              className="cursor-pointer rounded-full border-0 bg-transparent p-0"
            >
              <UserAvatar userId={user.id} name={displayName(user)} size={30} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* 个人设置入口（系统级 /settings，与退出登录并列）。 */}
            <DropdownMenuItem asChild>
              <Link
                href={personalSettingsHref()}
                data-testid="user-menu-settings"
              >
                <SettingsIcon />
                {t("personalSettings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => {
                void handleLogout();
              }}
            >
              <LogoutIcon />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span
          className="h-[30px] w-[30px] shrink-0 rounded-full bg-[#e8eaed]"
          aria-label={t("notSignedInAria")}
          role="img"
        />
      )}
    </header>
  );
}
