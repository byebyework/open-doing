"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 团队导航项（客户端）：当前路由高亮。
 *
 * 服务端导航桩（TeamsNav）无法感知路由，高亮逻辑下沉到本组件。
 */
export function TeamsNavItem({
  href,
  children,
  trailing,
}: {
  href: string;
  children: ReactNode;
  /** 右侧附加内容（如待处理数角标）。 */
  trailing?: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] no-underline transition-colors ${
        active
          ? "bg-[#f3ecfd] font-semibold text-[#7d2ae8]"
          : "text-[#3c4043] hover:bg-[#f5f6f7]"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}
