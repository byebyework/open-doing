"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/** 收起状态持久化 key（与原型 space-calendar-v2.html 同约定）。 */
const STORAGE_KEY = "od-sidebar-collapsed";

/**
 * localStorage 读写收敛为外部 store：快照带模块级缓存（同一次渲染内
 * 恒定，满足 useSyncExternalStore 的 getSnapshot 约定），写入后通知订阅者。
 */
let cachedCollapsed: boolean | null = null;
const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  if (cachedCollapsed === null) {
    cachedCollapsed = localStorage.getItem(STORAGE_KEY) === "1";
  }

  return cachedCollapsed;
}

function subscribeCollapsed(onChange: () => void): () => void {
  listeners.add(onChange);

  return () => {
    listeners.delete(onChange);
  };
}

function writeCollapsed(next: boolean): void {
  localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  cachedCollapsed = next;
  for (const listener of listeners) listener();
}

/** 服务端快照恒为展开态（localStorage 不可用）。 */
function serverCollapsed(): boolean {
  return false;
}

/** 读取侧栏收起状态（供 Topbar 等壳外组件联动）。 */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribeCollapsed, readCollapsed, serverCollapsed);
}

/** 切换侧栏收起状态（Topbar 伸缩按钮入口）。 */
export function toggleSidebarCollapsed(): void {
  writeCollapsed(!readCollapsed());
}

/**
 * 桌面侧栏伸缩壳（client）。
 *
 * - 展开 232px / 收起 68px 图标栏；状态持久化到 localStorage，
 *   挂载后经 useSyncExternalStore 读回（无 effect 内 setState，不触发
 *   级联渲染 / hydration mismatch）；
 * - 伸缩入口在 `Topbar` 左侧的图标按钮（`toggleSidebarCollapsed`），
 *   不在壳内——e2e flow 11 以「aside 内唯一 button」定位空间切换器
 *   触发器，aside 内不得出现其他按钮；
 * - 收起状态经 wrapper 上的 `data-collapsed` + `group/sidebar` 暴露，
 *   品牌区 / 空间切换器 / 导航项用 `group-data-[collapsed]/sidebar:*`
 *   自行隐藏文字、居中图标；
 * - ≤860px 侧栏整体隐藏；
 * - 布局冻结约束：仅包装 `Sidebar` 的内部结构，不触碰 `AppShell`
 *   的 props 契约与 `(dashboard)/layout.tsx` 的导入关系。
 */
export function SidebarShell({ children }: { children: ReactNode }) {
  const collapsed = useSidebarCollapsed();

  return (
    <div
      data-collapsed={collapsed || undefined}
      className="group/sidebar sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col transition-[width] duration-[420ms] ease-[cubic-bezier(0.4,0,0.2,1)] data-[collapsed]:w-[68px] min-[861px]:flex"
    >
      <aside className="flex min-h-0 flex-1 flex-col gap-2 border-r border-[var(--border-default)] bg-white px-3 py-4">
        {children}
      </aside>
    </div>
  );
}
