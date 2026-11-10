"use client";

/*
 * 浮层动效基础件：时长 / 缓动常量 + 各类浮层的 motion variants + 受控关闭桥
 * （useHeldOpen + createHeldOverlayRoot Root 封装工厂）。
 *
 * 时长沿用 2026-11-07 动效审核确定的 iOS 风格参数（原 CSS 动效层的各
 * animation-duration，2026-11-11 全部迁入 motion/react 后该层已删除）；
 * 缓动取计划规定的 OD_EASE 曲线（standard / decelerate / accelerate /
 * springIn / sheetIn）——部分与原 CSS 曲线相同，部分有意不同。改动时长时
 * 必须同步组件侧的保持窗口（exitMs）。
 *
 * - OD_MS：遮罩 / 弹窗 / 轻量浮层 / 抽屉的进出场时长（毫秒）；
 * - OD_EASE：standard 为通用曲线；decelerate 用于入场、accelerate 用于退场；
 *   springIn 是原弹窗 / 轻量浮层的弹簧曲线；sheetIn 是抽屉入场曲线；
 * - variants 命名统一为 open（可见终态）/ closed（仅作退场目标态；
 *   入场初值取关键帧的第一帧，与 closed 值无关）。
 */

import * as React from "react";
import { useEffect, useState } from "react";
import type { Variants } from "motion/react";

/** 时长（毫秒），沿用 2026-11-07 动效审核的原 CSS animation-duration。 */
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

/** 缓动曲线（cubic-bezier 控制点），计划规定的 OD_EASE 曲线（部分与原 CSS 曲线相同，部分有意不同）。 */
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

/** Radix Root 共有的开关受控属性（Dialog / Popover / DropdownMenu / Select 一致）。 */
export type HeldOverlayRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
};

/**
 * 关闭桥的 Root 封装工厂（dialog / alert-dialog / popover / dropdown-menu /
 * select 共用）：返回一个 Radix Root 包装组件、一个 visible Context 与一个
 * keep-mounted Context。
 *
 * mode: "held"（默认，dialog / alert-dialog / sheet）——Radix Root 的 open
 * 传 useHeldOpen(desiredOpen, exitMs) 的保持值，退出动画在保持窗口内播完
 * 后 Radix 才真正卸载内容。
 *
 * mode: "immediate"（pop 家族：popover / dropdown-menu / select）——Radix
 * Root 的 open 即时跟随 desiredOpen。原因：这三类浮层的触发器靠 Radix 的
 * toggle 语义开关，若 Root 在保持窗口内仍是 open，窗口内再点触发器会被算成
 * 「请求关闭」，首次重开点击是死的；Root 即时关闭后 toggle 立即算回 true。
 * 退场改由 Content 侧维持：消费方从 MountContext 拿保持值给 Portal/Content
 * 挂 Radix forceMount，keep-mounted 在 desiredOpen 翻 false 后仍保持
 * exitMs，随后落 false 触发真正卸载。
 *
 * immediate 模式附带一次「同事件残留 dismiss」抑制：触发器 toggle 重开的
 * 那次 pointerdown / click / keydown 里，尚未卸载的退场内容仍有活的
 * DismissableLayer，会在同一事件的 document 冒泡阶段发 close（Popover 有
 * Radix 自己的触发器豁免，DropdownMenu / Select 没有）。工厂在 document
 * 捕获阶段监听这三类事件作为「事件边界」重置标记，onOpenChange(true) 置位
 * 标记，同一事件内随后到达的 close 视为残留 dismiss 吞掉；真实关闭都来自
 * 之后的新事件，不受影响。
 *
 * - 包装组件维护 desiredOpen（受控取 props.open，非受控取内部态），
 *   onOpenChange 仍即时回调、不延迟。
 * - VisibleContext 下发 desiredOpen（不是保持值）：Overlay / Content 据此
 *   在 open / closed variants 间直接切换，不依赖 AnimatePresence 卸载。
 * - MountContext 下发 useHeldOpen 的保持值（held 模式下与 Root open 一致，
 *   仅供 immediate 模式消费方挂 forceMount 使用）。
 * - 每次调用生成独立的 Context，保证嵌套浮层（如 Select 在 Dialog 内）不会
 *   互相串状态。
 */
export function createHeldOverlayRoot<P extends HeldOverlayRootProps>(
  Root: React.ComponentType<P>,
  options: {
    dataSlot: string;
    exitMs: number;
    displayName: string;
    /** "held"（默认）：Root open 用保持值；"immediate"：Root open 即时跟随 desiredOpen。 */
    mode?: "held" | "immediate";
  },
): {
  Root: React.ComponentType<P>;
  VisibleContext: React.Context<boolean>;
  /** 退场保持窗口内为 true：immediate 模式消费方据此给 Portal/Content 挂 forceMount。 */
  MountContext: React.Context<boolean>;
} {
  const VisibleContext = React.createContext(true);
  const MountContext = React.createContext(false);
  const immediate = options.mode === "immediate";

  function HeldOverlayRoot(props: P): React.ReactNode {
    const { open: controlledOpen, defaultOpen, onOpenChange, ...rest } = props;
    const isControlled = controlledOpen !== undefined;
    const [desiredOpen, setDesiredOpen] = React.useState(defaultOpen ?? false);
    // ?? 而非三元:TS 无法经 isControlled 收窄 controlledOpen,受控时取受控值。
    const visible = controlledOpen ?? desiredOpen;
    const heldOpen = useHeldOpen(visible, options.exitMs);

    // 同事件残留 dismiss 抑制（见工厂注释）：捕获阶段事件边界重置。
    const openInEventRef = React.useRef(false);
    React.useEffect(() => {
      if (!immediate) {
        return;
      }
      const markEventBoundary = () => {
        openInEventRef.current = false;
      };
      document.addEventListener("pointerdown", markEventBoundary, true);
      document.addEventListener("keydown", markEventBoundary, true);
      document.addEventListener("click", markEventBoundary, true);
      return () => {
        document.removeEventListener("pointerdown", markEventBoundary, true);
        document.removeEventListener("keydown", markEventBoundary, true);
        document.removeEventListener("click", markEventBoundary, true);
      };
    }, [immediate]);

    const rootProps = {
      // 与原生写法一致:data-slot 在前,消费方仍可覆盖。
      "data-slot": options.dataSlot,
      ...rest,
      open: immediate ? visible : heldOpen,
      onOpenChange: (next: boolean) => {
        if (immediate) {
          if (next) {
            openInEventRef.current = true;
          } else if (openInEventRef.current) {
            // 同一事件里 toggle 刚请求过 open：这是退场层的残留 dismiss。
            return;
          }
        }
        if (!isControlled) setDesiredOpen(next);
        onOpenChange?.(next);
      },
    } as unknown as P;

    return React.createElement(
      VisibleContext.Provider,
      { value: visible },
      React.createElement(
        MountContext.Provider,
        { value: heldOpen },
        React.createElement(Root, rootProps),
      ),
    );
  }
  HeldOverlayRoot.displayName = options.displayName;

  return { Root: HeldOverlayRoot, VisibleContext, MountContext };
}
