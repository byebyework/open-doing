"use client";

import { PanelRightIcon } from "lucide-react";
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
        <div className="min-w-0">{children}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{children}</div>
          <div className="flex flex-col gap-4 lg:sticky lg:top-[76px] lg:self-start">
            {sidebar}
          </div>
        </div>
      )}
    </div>
  );
}
