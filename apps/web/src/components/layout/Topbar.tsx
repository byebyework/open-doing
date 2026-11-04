"use client";

import type { User } from "@open-doing/types";
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
import { Input } from "@/components/ui/shadcn/input";
import { logoutAction } from "@/features/auth/actions";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";

/** Topbar 入参。 */
export interface TopbarProps {
  /** 当前登录用户；F-6 接入会话前为 null（此时展示中性占位头像）。 */
  user: User | null;
  /** 移动端导航入口（Task 6 接入 `<MobileNav />`），渲染在品牌标记之前。 */
  mobileNav?: ReactNode;
}

/**
 * 顶栏：品牌/面包屑位 + 禁用态搜索框 + 通知占位 + 用户头像。
 *
 * `<NotificationBell />` 当前渲染 null，N-2 在原路径替换实现；
 * 搜索框在空间/全局搜索接线前保持禁用，≤860px 隐藏（与原型一致）。
 */
export function Topbar({ user, mobileNav }: TopbarProps) {
  const router = useRouter();
  const t = useTranslations("nav");
  const [loggingOut, setLoggingOut] = useState(false);

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

      {/* 移动端无侧栏时保留品牌标识 */}
      <span
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[14px] font-extrabold text-white min-[861px]:hidden"
        aria-hidden="true"
      >
        O
      </span>
      <div className="truncate text-[13px] text-[var(--ink-500)]">Open Doing</div>

      {/* 禁用态搜索框：键盘快捷键与搜索功能由后续轨道接入 */}
      <div className="relative ml-auto hidden w-[240px] shrink-0 min-[861px]:block">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-400)]"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <Input
          disabled
          aria-label={t("searchAria")}
          placeholder={t("searchPlaceholder")}
          className="pr-10 pl-8"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[var(--border-default)] bg-white px-1.5 font-mono text-[11px] text-[var(--ink-500)]">
          ⌘K
        </kbd>
      </div>

      {/* 通知入口占位：N-2 替换实现，路径不变 */}
      <NotificationBell />

      {/* 用户头像区：点击打开用户菜单（v1 仅退出登录） */}
      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={loggingOut}>
            <button
              type="button"
              data-testid="user-menu-button"
              aria-label={t("currentUserAria", { name: user.username })}
              className="cursor-pointer rounded-full border-0 bg-transparent p-0"
            >
              <UserAvatar username={user.username} size={30} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => {
                void handleLogout();
              }}
            >
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
