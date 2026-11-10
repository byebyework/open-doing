"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 无令牌适配。
 * 动效(2026-11-11 迁移到 motion/react):shadcn 自带的 tailwindcss-animate
 * 工具类在本仓库不存在(死类),此前改挂一层 iOS 风格的 CSS 动效(内容
 * 小行程弹簧);现按「动效全走 Motion」约定迁到 overlay-motion.ts
 * 的 popVariants,并沿用 dialog.tsx 的关闭保持桥(createHeldOverlayRoot,
 * 保持 OD_MS.popOut=150ms,退场播完才真正卸载)。缩放原点由 style 的
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

const { Root: PopoverRoot, VisibleContext: PopoverVisibleContext } =
  createHeldOverlayRoot(PopoverPrimitive.Root, {
    dataSlot: "popover",
    exitMs: OD_MS.popOut,
    displayName: "Popover",
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
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        asChild
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
