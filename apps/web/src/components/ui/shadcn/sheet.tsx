"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 适配:dialog 同源遮罩色;供 MobileNav(Drawer → Sheet)消费;关闭钮 sr-only 文案走 next-intl(common.close),不硬编码英文。
 *
 * 动效(2026-11-11 迁移到 motion/react):shadcn 自带的 tailwindcss-animate
 * 工具类在本仓库不存在(死类,曾导致抽屉零动画),此前改挂一层 iOS 风格的
 * CSS 抽屉动效(方向性滑入 + 加速滑出);现按「动效全走 Motion」约定迁到
 * overlay-motion.ts 的 sheetVariants,设计意图保持不变——保留方向感,
 * 沿 side 方向 ±100% 滑入(0.4s,iOS 抽屉曲线)/ 加速滑出(0.3s,退出比
 * 进入短,符合 iOS 语义)。prefers-reduced-motion 由根 Providers 的
 * MotionConfig 统一处理。
 *
 * 侧边定位(inset-y-0 right-0 / inset-x-0 bottom-0 等)仍是 Tailwind 类:
 * Motion 只用 x/y 百分比承担位移,不写 translate-* 工具类(Motion 独占
 * transform);内容经 Radix Content 的 asChild 落在 motion.div 上,Radix Slot
 * 负责合并 props/ref,因此请保持单子元素,也不要再给内容挂 transform 类。
 *
 * 关闭桥(沿用 overlay-motion.ts 的 createHeldOverlayRoot,与 dialog /
 * popover 同构):Radix 在 open 翻 false 的瞬间卸载 Portal,纯 AnimatePresence
 * 看不到退场。封装内部维护 desiredOpen,Radix Root 的 open 传
 * useHeldOpen(desiredOpen, OD_MS.sheetOut=300ms) 的保持值——退出动画播完
 * 才真正卸载;Overlay / Content 通过 VisibleContext 拿 desiredOpen,直接在
 * open / closed variants 间切换。注意保持窗口内内容仍挂载且保持可交互
 * (Radix 看到的仍是 open),消费方不要依赖「关闭即卸载/重置」的时序。
 */
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { motion, type TargetAndTransition } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";

import {
  createHeldOverlayRoot,
  OD_MS,
  overlayVariants,
  sheetVariantsBySide,
} from "@/components/ui/overlay-motion";
import { cn } from "@/lib/utils";

const { Root: SheetRoot, VisibleContext: SheetVisibleContext } =
  createHeldOverlayRoot(SheetPrimitive.Root, {
    dataSlot: "sheet",
    exitMs: OD_MS.sheetOut,
    displayName: "Sheet",
  });

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetRoot {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  const visible = React.useContext(SheetVisibleContext);
  return (
    <SheetPrimitive.Overlay asChild {...props}>
      <motion.div
        data-slot="sheet-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-[rgba(14,19,24,0.45)]",
          className,
        )}
        initial={{ opacity: 0 }}
        animate={visible ? "open" : "closed"}
        variants={overlayVariants}
      />
    </SheetPrimitive.Overlay>
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
}) {
  const t = useTranslations("common");
  const visible = React.useContext(SheetVisibleContext);
  const variants = sheetVariantsBySide[side];
  // 入场初值取 closed 的位移(与入场关键帧首帧一致):原点在屏幕外,挂载即滑入。
  // Variants 的值是 TargetAndTransition | TargetResolver,先收窄才能取属性。
  const exit = variants.closed as TargetAndTransition;
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content asChild {...props}>
        <motion.div
          data-slot="sheet-content"
          className={cn(
            "bg-card fixed z-50 flex flex-col gap-4 shadow-lg",
            side === "right" &&
              "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
            side === "left" &&
              "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
            side === "top" && "inset-x-0 top-0 h-auto border-b",
            side === "bottom" && "inset-x-0 bottom-0 h-auto border-t",
            className,
          )}
          initial={{ x: exit.x, y: exit.y }}
          animate={visible ? "open" : "closed"}
          variants={variants}
        >
          {children}
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring/40 data-[state=open]:bg-accent absolute top-4 right-4 rounded-[var(--radius-4)] opacity-60 transition-[opacity,box-shadow] outline-none hover:opacity-100 focus:ring-[3px] disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">{t("close")}</span>
          </SheetPrimitive.Close>
        </motion.div>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
