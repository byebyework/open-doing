"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 适配:遮罩用 --ink-900/45(对齐原型 .dialog-overlay);关闭钮 sr-only 文案走 next-intl(common.close),不硬编码英文。
 *
 * 动效(2026-11-11 迁移到 motion/react):shadcn 自带的 tailwindcss-animate
 * 工具类在本仓库不存在(死类,曾导致弹窗零动画),此前改挂一层 iOS 风格的
 * CSS 动效(遮罩淡入淡出 + 弹窗弹簧);现按「动效全走 Motion」约定迁到
 * overlay-motion.ts 的 variants,设计意图保持不变——遮罩淡入
 * 0.25s / 淡出 0.2s(与内容速度分层产生层次感),内容 scale 0.88→1 弹簧进入
 * (opacity 在 60% 关键帧先到 1)、退出 0.2s 加速缩小(进入比退出长,iOS 语义);
 * prefers-reduced-motion 由根 Providers 的 MotionConfig 统一处理。
 *
 * 关闭桥(2026-11-11 提取到 overlay-motion.ts 的 createHeldOverlayRoot,
 * popover / dropdown / select / sheet 迁移沿用同一封装):Radix 在 open 翻
 * false 的瞬间卸载 Portal,纯 AnimatePresence 看不到退场。封装内部维护
 * desiredOpen(受控取 props.open,非受控取内部态,onOpenChange 仍即时回调、
 * 不延迟),Radix Root 的 open 传 useHeldOpen(desiredOpen, OD_MS.modalOut)
 * 的保持值,让退出动画在保持窗口内播完再真正卸载;Overlay / Content 通过
 * 封装下发的 VisibleContext 拿 desiredOpen,直接在 open / closed variants
 * 间切换,不依赖 AnimatePresence 卸载。Motion 独占 transform,居中定位由
 * style 的 x/y(-50%)承担,原 translate-x/y-* 类已删。
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  createHeldOverlayRoot,
  modalVariants,
  OD_MS,
  overlayVariants,
} from "@/components/ui/overlay-motion";
import { cn } from "@/lib/utils";

const {
  Root: DialogRoot,
  VisibleContext: DialogVisibleContext,
} = createHeldOverlayRoot(DialogPrimitive.Root, {
  dataSlot: "dialog",
  exitMs: OD_MS.modalOut,
  displayName: "Dialog",
});

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogRoot {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const visible = React.useContext(DialogVisibleContext);
  return (
    <DialogPrimitive.Overlay asChild {...props}>
      <motion.div
        data-slot="dialog-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-[rgba(14,19,24,0.45)]",
          className,
        )}
        initial={{ opacity: 0 }}
        animate={visible ? "open" : "closed"}
        variants={overlayVariants}
      />
    </DialogPrimitive.Overlay>
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const t = useTranslations("common");
  const visible = React.useContext(DialogVisibleContext);
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content asChild {...props}>
        <motion.div
          data-slot="dialog-content"
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
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="ring-offset-background focus:ring-ring/40 data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-[var(--radius-4)] opacity-60 transition-[opacity,box-shadow] outline-none hover:opacity-100 focus:ring-[3px] focus:ring-[3px] disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
            >
              <XIcon />
              <span className="sr-only">{t("close")}</span>
            </DialogPrimitive.Close>
          )}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
