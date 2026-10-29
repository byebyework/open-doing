"use client";

import { useSyncExternalStore } from "react";

/** 与 Tailwind `min-[861px]` 断点保持一致：仅桌面端启用拖拽。 */
const DESKTOP_MEDIA_QUERY = "(min-width: 861px)";

function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  query.addEventListener("change", callback);

  return () => query.removeEventListener("change", callback);
}

function getDesktopSnapshot() {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/** 服务端（及水合首帧）按窄屏处理：不渲染任何拖拽行为。 */
function getDesktopServerSnapshot() {
  return false;
}

/**
 * 是否处于桌面宽度。
 *
 * 窄屏下看板退化为单列 + 状态按钮，卡片主体必须把触摸滚动交还浏览器：
 * 拖拽监听会吞掉 touch 滚动，因此按断点整体关闭，而不是仅隐藏样式。
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getDesktopServerSnapshot,
  );
}
