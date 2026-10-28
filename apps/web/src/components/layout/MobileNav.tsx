"use client";

import { Button, Drawer } from "antd";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { SpaceNavData } from "./SpaceNavData";
import { SpaceNavMenu } from "./SpaceNavMenu";
import { SpaceSwitcher } from "./SpaceSwitcher";

/** MobileNav 入参。 */
export interface MobileNavProps {
  /** 布局层一次性取好的导航数据（与桌面侧栏同源）。 */
  data: SpaceNavData;
}

/** 汉堡图标（三横线），尺寸与顶栏其它图标对齐。 */
function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/**
 * 移动端导航入口（<861px）。
 *
 * 顶栏汉堡按钮打开 antd Drawer，内容与桌面侧栏同源：
 * 品牌行 → 空间切换器 → 五模块 + 账号分组（`SpaceNavMenu`）。
 * 路由变化（点击任一导航项）时在渲染期同步关闭 Drawer，
 * 沿用项目既有的「渲染期同步 props → state」写法，避免 effect 中 setState。
 */
export function MobileNav({ data }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [syncedPathname, setSyncedPathname] = useState(pathname);

  // 首次渲染不触发关闭（syncedPathname 初始值即当前路径）；
  // 路径变化时无条件记录，Drawer 打开中也同步关闭。若只在 `open` 时同步，
  // Drawer 关闭期间发生的导航会留下过期 syncedPathname，导致下一次点击汉堡
  // 在渲染期被立即关回（首次点击静默失效）。
  if (pathname !== syncedPathname) {
    setSyncedPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <>
      <Button
        type="text"
        aria-label="打开导航"
        aria-expanded={open}
        className="min-[861px]:hidden"
        onClick={() => setOpen(true)}
        icon={<MenuIcon />}
      />

      <Drawer
        placement="left"
        width={280}
        open={open}
        onClose={() => setOpen(false)}
        title={
          /* 品牌行：复用 Topbar 的品牌标记与名称 */
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-[linear-gradient(135deg,#7d2ae8_0%,#00c4cc_100%)] text-[14px] font-extrabold text-white"
              aria-hidden="true"
            >
              O
            </span>
            <div className="truncate text-[13px] text-[#5f6368]">Open Doing</div>
          </div>
        }
        styles={{ body: { padding: 12 } }}
      >
        <div className="flex flex-col">
          <SpaceSwitcher teams={data.teams} />
          <nav className="flex flex-col gap-1">
            <SpaceNavMenu data={data} />
          </nav>
        </div>
      </Drawer>
    </>
  );
}
