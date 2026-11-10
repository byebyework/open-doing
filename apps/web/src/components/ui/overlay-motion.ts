"use client";

/*
 * 浮层动效基础件：时长 / 缓动常量 + 各类浮层的 motion variants + 受控关闭桥。
 *
 * 时长与 `apps/web/src/app/motion.css`（iOS 风格浮层动效）的各
 * animation-duration 逐一对应；缓动则取计划规定的 OD_EASE 曲线
 * （decelerate / accelerate / accelerate / springIn / sheetIn），
 * 与 motion.css 的原始 CSS 曲线有意不同（motion.css 将在后续任务中删除，
 * 动画全部迁移到 motion/react）。改动任一侧时长时必须同步另一侧。
 *
 * - OD_MS：遮罩 / 弹窗 / 轻量浮层 / 抽屉的进出场时长（毫秒）；
 * - OD_EASE：standard 为通用曲线；decelerate 用于入场、accelerate 用于退场；
 *   springIn 是原 od-modal / od-popover 的弹簧曲线；sheetIn 是抽屉入场曲线；
 * - variants 命名统一为 open（可见终态）/ closed（仅作退场目标态；
 *   入场初值取关键帧的第一帧，与 closed 值无关）。
 */

import { useEffect, useState } from "react";
import type { Variants } from "motion/react";

/** 时长（毫秒），与 motion.css 各 animation-duration 逐一对应。 */
export const OD_MS = {
  overlayIn: 250,
  overlayOut: 200,
  modalIn: 420,
  modalOut: 200,
  popIn: 280,
  popOut: 150,
  sheetIn: 400,
  sheetOut: 300,
} as const;

/** 缓动曲线（cubic-bezier 控制点），计划规定的 OD_EASE 曲线（非 motion.css 原始 CSS 曲线）。 */
export const OD_EASE = {
  standard: [0.4, 0, 0.2, 1], // --ease-standard
  decelerate: [0, 0, 0.2, 1], // --ease-decelerate（入场）
  accelerate: [0.3, 0, 1, 1], // --ease-accelerate（退场）
  springIn: [0.34, 1.4, 0.64, 1], // 原 od-spring-in 曲线
  sheetIn: [0.32, 0.72, 0, 1],
} as const;

/** 遮罩：淡入 250ms / 淡出 200ms。 */
export const overlayVariants: Variants = {
  open: {
    opacity: 1,
    transition: { duration: OD_MS.overlayIn / 1000, ease: OD_EASE.decelerate },
  },
  closed: {
    opacity: 0,
    transition: { duration: OD_MS.overlayOut / 1000, ease: OD_EASE.accelerate },
  },
};

/** 中心弹窗：scale 0.88→1 弹簧进入，opacity 在 60% 关键帧处先到 1（同原 od-spring-in）；退出缩小到 0.92。 */
export const modalVariants: Variants = {
  open: {
    opacity: [0, 1, 1],
    scale: [0.88, 1],
    transition: {
      duration: OD_MS.modalIn / 1000,
      ease: OD_EASE.springIn,
      opacity: { times: [0, 0.6, 1], duration: OD_MS.modalIn / 1000, ease: OD_EASE.springIn },
    },
  },
  closed: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: OD_MS.modalOut / 1000, ease: OD_EASE.accelerate },
  },
};

/** 轻量浮层：scale 0.96→1 小行程弹簧；退出 0.97。 */
export const popVariants: Variants = {
  open: {
    opacity: [0, 1],
    scale: [0.96, 1],
    transition: { duration: OD_MS.popIn / 1000, ease: OD_EASE.springIn },
  },
  closed: {
    opacity: 0,
    scale: 0.97,
    transition: { duration: OD_MS.popOut / 1000, ease: OD_EASE.accelerate },
  },
};

/** 抽屉：沿 side 方向 ±100% 滑入 / 滑出（open 归位到 0，closed 滑出屏幕）。 */
export function sheetVariants(side: "right" | "left" | "top" | "bottom"): Variants {
  const exitX = side === "right" ? "100%" : side === "left" ? "-100%" : 0;
  const exitY = side === "bottom" ? "100%" : side === "top" ? "-100%" : 0;
  return {
    open: {
      x: 0,
      y: 0,
      transition: { duration: OD_MS.sheetIn / 1000, ease: OD_EASE.sheetIn },
    },
    closed: {
      x: exitX,
      y: exitY,
      transition: { duration: OD_MS.sheetOut / 1000, ease: OD_EASE.accelerate },
    },
  };
}

/**
 * 受控关闭桥：open 翻 false 后返回值保持 true 共 exitMs（让退出动画播完，
 * 消费方据此决定何时真正卸载内容），随后落回 false；open 重新为 true 时
 * 取消计时并立即恢复 true。初始返回值跟随初始 open。
 */
export function useHeldOpen(open: boolean, exitMs: number): boolean {
  const [held, setHeld] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // React 官方「渲染期间调整状态」模式：open 翻 false 的那一刻进入保持窗口，
  // 不经 effect 设状态（react-hooks/set-state-in-effect）。
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setHeld(true);
    }
  }

  useEffect(() => {
    if (open || !held) {
      return;
    }
    const timer = setTimeout(() => setHeld(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, held, exitMs]);

  return open || held;
}
