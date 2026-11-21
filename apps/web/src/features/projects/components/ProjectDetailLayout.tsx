"use client";

import { PanelRightIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/shadcn/button";

export interface ProjectDetailLayoutProps {
  /** 右侧栏内容（Properties + Milestones 卡）。 */
  sidebar: ReactNode;
  /** 主列内容（概览面板或任务表格/看板）。 */
  children: ReactNode;
}

/**
 * 详情页布局（对照 Linear）：右上角切换按钮收起/展开右侧栏；
 * 展开时主列 + 320px sticky 侧栏，收起时主列全宽。
 */
export function ProjectDetailLayout({ sidebar, children }: ProjectDetailLayoutProps) {
  const t = useTranslations("projects");
  const prefersReducedMotion = useReducedMotion();
  const [hidden, setHidden] = useState(false);

  return (
    <div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="sidebar-toggle"
          aria-label={t("sidebarToggle")}
          aria-pressed={!hidden}
          onClick={() => setHidden((current) => !current)}
        >
          <PanelRightIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {hidden ? (
        <motion.div
          key="main-full"
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.16 }}
          className="min-w-0"
        >
          {children}
        </motion.div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{children}</div>
          {/* 侧栏抽屉：自右滑入展开 / 收起（0.28s 拉出，reduced-motion 降级）。 */}
          <AnimatePresence initial={false}>
            {!hidden ? (
              <motion.aside
                key="sidebar"
                initial={prefersReducedMotion ? false : { x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { x: 24, opacity: 0 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { x: { duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }, opacity: { duration: 0.2 } }
                }
                className="flex flex-col gap-4 self-start lg:sticky lg:top-[76px]"
              >
                {sidebar}
              </motion.aside>
            ) : null}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
