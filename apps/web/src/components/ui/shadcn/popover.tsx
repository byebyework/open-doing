"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 无令牌适配。
 * 动效(2026-11-11 迁移到 motion/react):shadcn 自带的 tailwindcss-animate
 * 工具类在本仓库不存在(死类),此前改挂一层 iOS 风格的 CSS 动效(内容
 * 小行程弹簧);现按「动效全走 Motion」约定迁到 overlay-motion.ts
 * 的 popVariants。关闭保持桥用 createHeldOverlayRoot 的 immediate 模式
 * (保持 OD_MS.popOut=150ms):Root open 即时跟随 desiredOpen(否则保持窗口
 * 内再点触发器会被 Radix 算成「请求关闭」,首次重开点击是死的),退场内容经
 * MountContext 的保持值挂 Portal/Content 的 forceMount 维持挂载,窗口过后
 * 才真正卸载;窗口内内容 pointer-events:none 不可交互。缩放原点由 style 的
 * transform-origin 跟随 Radix 弹出的锚点角(--radix-popover-content-
 * transform-origin),原 origin-(--radix-...) 类与旧的 CSS 动效类已删。
 */
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { motion } from "motion/react";
import * as React from "react";

import {
  createHeldOverlayRoot,
  OD_MS,
  popVariants,
} from "@/components/ui/overlay-motion";
import { cn } from "@/lib/utils";

const {
  Root: PopoverRoot,
  VisibleContext: PopoverVisibleContext,
  MountContext: PopoverMountContext,
} = createHeldOverlayRoot(PopoverPrimitive.Root, {
  dataSlot: "popover",
  exitMs: OD_MS.popOut,
  displayName: "Popover",
  mode: "immediate",
});

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverRoot {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  children,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const visible = React.useContext(PopoverVisibleContext);
  const keepMounted = React.useContext(PopoverMountContext);
  return (
    <PopoverPrimitive.Portal forceMount={keepMounted || undefined}>
      <PopoverPrimitive.Content
        asChild
        forceMount={keepMounted || undefined}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <motion.div
          data-slot="popover-content"
          className={cn(
            "bg-popover text-popover-foreground z-50 w-72 rounded-[var(--radius-8)] border p-4 shadow-md outline-hidden",
            className,
          )}
          style={{
            transformOrigin: "var(--radix-popover-content-transform-origin)",
            // 退场保持窗口内内容不可交互。仅在 !visible 时才写入该键:
            // Radix 经 Slot 合并 style,打开态若显式写 undefined 会覆盖掉
            // DismissableLayer 的 pointer-events:auto,导致打开的浮层点不了。
            ...(visible ? {} : { pointerEvents: "none" as const }),
          }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={visible ? "open" : "closed"}
          variants={popVariants}
        >
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
