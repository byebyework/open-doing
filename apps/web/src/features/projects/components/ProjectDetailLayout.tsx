"use client";

import { PanelRightIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Children, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/shadcn/button";

export interface ProjectDetailLayoutProps {
  /** 右侧栏内容（Properties + Milestones 卡）。 */
  sidebar: ReactNode;
  /** 主列内容（概览面板）。 */
  children: ReactNode;
}

const SIDEBAR_HIDDEN_KEY = "project-detail-sidebar-hidden";

/** 主列与侧栏卡片入场：与站内动效语言一致（快、克制、无过冲）。 */
const VIEW_TRANSITION = { duration: 0.2, ease: "easeOut" as const };

/** 侧栏卡片级联间隔：Properties → Milestones → Progress 依次入场。 */
const SIDEBAR_STAGGER = 0.04;

/**
 * 详情页布局（对照 Linear 实测口径）：右上角切换按钮瞬时收起/展开右侧栏，
 * 状态持久化到 localStorage。布局级切换不做动画（Linear 同款哲学：
 * 动效只留给轻交互），reduced-motion 用户无差异成本。
 *
 * 动效范围：主列与侧栏卡片首次挂载级联入场；收起/展开本身保持瞬时。
 */
export function ProjectDetailLayout({ sidebar, children }: ProjectDetailLayoutProps) {
  const t = useTranslations("projects");
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0");
    } catch {
      /* 隐私模式等 localStorage 不可用：仅状态不持久化 */
    }
  }, [hidden]);

  const main = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={VIEW_TRANSITION}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );

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
        // WHY: 976 = 容器1320 − 侧栏320 − gap24，与侧栏展开时主列同宽；
        // 收起后主列不再撑满整页而是居中，评论输入等宽度保持不变。
        <div className="mx-auto min-w-0 max-w-[976px]">{main}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {main}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...VIEW_TRANSITION, delay: SIDEBAR_STAGGER }}
            className="flex flex-col gap-4 self-start lg:sticky lg:top-[76px]"
          >
            {Children.map(sidebar, (card, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut", delay: SIDEBAR_STAGGER * (index + 1) }}
              >
                {card}
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}
