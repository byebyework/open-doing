"use client";

import { PanelRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/shadcn/button";

export interface ProjectDetailLayoutProps {
  /** 右侧栏内容（Properties + Milestones 卡）。 */
  sidebar: ReactNode;
  /** 主列内容（概览面板或任务表格/看板）。 */
  children: ReactNode;
}

const SIDEBAR_HIDDEN_KEY = "project-detail-sidebar-hidden";

/**
 * 详情页布局（对照 Linear 实测口径）：右上角切换按钮瞬时收起/展开右侧栏，
 * 状态持久化到 localStorage。布局级切换不做动画（Linear 同款哲学：
 * 动效只留给轻交互），reduced-motion 用户无差异成本。
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
        <div className="min-w-0">{children}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{children}</div>
          <div className="flex flex-col gap-4 self-start lg:sticky lg:top-[76px]">{sidebar}</div>
        </div>
      )}
    </div>
  );
}
