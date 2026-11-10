"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 适配:destructive 按钮/footer 组合用于删除确认(原型 disband-modal 模式)。
 *
 * 动效(2026-11-11 迁移到 motion/react):shadcn 自带的 tailwindcss-animate
 * 工具类在本仓库不存在(死类,曾导致弹窗零动画),此前改挂一层 iOS 风格的
 * CSS 动效(遮罩淡入淡出 + 弹窗弹簧);现按「动效全走 Motion」约定迁到
 * overlay-motion.ts 的 variants,设计意图保持不变——遮罩淡入
 * 0.25s / 淡出 0.2s(与内容速度分层),内容 scale 0.88→1 弹簧进入、退出 0.2s
 * 加速缩小(进入比退出长,iOS 语义);prefers-reduced-motion 由根 Providers
 * 的 MotionConfig 统一处理。居中定位由 motion style 的 x/y(-50%)承担,
 * 原 translate-x/y-* 类已删(Motion 独占 transform)。
 *
 * 关闭桥与 dialog.tsx 同构(2026-11-11 两者都改用 overlay-motion.ts 的
 * createHeldOverlayRoot:desiredOpen + useHeldOpen 保持 Root,variants 按
 * desiredOpen 直接切换,不依赖 AnimatePresence 卸载);AlertDialogAction
 * 「点击即关」的默认行为保持(Radix Action 触发 onOpenChange(false),由本
 * 桥接播放退场后再卸载)。
 */
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { motion } from "motion/react";
import * as React from "react";

import {
  createHeldOverlayRoot,
  modalVariants,
  OD_MS,
  overlayVariants,
} from "@/components/ui/overlay-motion";
import { buttonVariants } from "@/components/ui/shadcn/button";
import { cn } from "@/lib/utils";

const {
  Root: AlertDialogRoot,
  VisibleContext: AlertDialogVisibleContext,
} = createHeldOverlayRoot(AlertDialogPrimitive.Root, {
  dataSlot: "alert-dialog",
  exitMs: OD_MS.modalOut,
  displayName: "AlertDialog",
});

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogRoot {...props} />;
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  const visible = React.useContext(AlertDialogVisibleContext);
  return (
    <AlertDialogPrimitive.Overlay asChild {...props}>
      <motion.div
        data-slot="alert-dialog-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-[rgba(14,19,24,0.45)]",
          className,
        )}
        initial={{ opacity: 0 }}
        animate={visible ? "open" : "closed"}
        variants={overlayVariants}
      />
    </AlertDialogPrimitive.Overlay>
  );
}

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const visible = React.useContext(AlertDialogVisibleContext);
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content asChild {...props}>
        <motion.div
          data-slot="alert-dialog-content"
          className={cn(
            "bg-card fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-[var(--radius-12)] p-6 shadow-lg sm:max-w-lg",
            className,
          )}
          style={{ x: "-50%", y: "-50%" }}
          initial={{ opacity: 0, scale: 0.88 }}
          animate={visible ? "open" : "closed"}
          variants={modalVariants}
        >
          {children}
        </motion.div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
