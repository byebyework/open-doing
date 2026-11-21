"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { CollapseReveal } from "./CollapseReveal";

export interface ProjectProgressPanelProps {
  /** 项目整体进度 0–100 整数。 */
  percent: number;
}

/** 右侧 Progress 卡（对照 Linear，默认折叠）：整体进度条。 */
export function ProjectProgressPanel({ percent }: ProjectProgressPanelProps) {
  const t = useTranslations("projects");
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section
      data-testid="project-progress-panel"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <button
        type="button"
        data-testid="progress-collapse"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full cursor-pointer items-center gap-2 text-[13px] font-semibold text-[var(--ink-900)]"
      >
        {t("progressTitle")}
        <ChevronRightIcon
          className={`size-3.5 text-[var(--color-text-muted)] transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          aria-hidden="true"
        />
        <span className="ml-auto tabular-nums text-[12.5px] text-[var(--color-text-muted)]">
          {percent}%
        </span>
      </button>
      <CollapseReveal open={!collapsed}>
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-progress-bg)]">
            <span
              className="block h-full rounded-full bg-[var(--color-progress)] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </span>
        </div>
      </CollapseReveal>
    </section>
  );
}
