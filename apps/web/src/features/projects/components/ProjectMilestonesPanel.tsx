"use client";

import { PlusIcon } from "lucide-react";
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ProjectMilestonesSection } from "./ProjectMilestonesSection";
import { CollapseReveal } from "./CollapseReveal";
import type { ProjectMilestone } from "@open-doing/types";
import { type ProjectFormSpace } from "./ProjectForm";

export interface ProjectMilestonesPanelProps {
  space: ProjectFormSpace;
  projectId: string;
  milestones: ProjectMilestone[];
  canManage: boolean;
  /** 里程碑进度（compact 行右侧文案）。 */
  progress?: Record<string, { taskCount: number; doneCount: number; percent: number }>;
}

/** 右侧 Milestones 卡：标题 + 复用 ProjectMilestonesSection（增删改）。 */
export function ProjectMilestonesPanel({
  space,
  projectId,
  milestones,
  canManage,
  progress,
}: ProjectMilestonesPanelProps) {
  const t = useTranslations("projects");
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);

  return (
    <section
      data-testid="project-milestones-panel"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <div className="mb-2 flex w-full items-center gap-2">
        <button
          type="button"
          data-testid="milestones-collapse"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
          className={`flex items-center gap-2 text-[13px] font-semibold text-[var(--ink-900)] ${
            milestones.length > 0 || canManage ? "cursor-pointer" : "cursor-default"
          }`}
        >
          {t("milestoneSectionTitle")}
          {milestones.length > 0 ? (
            <span className="rounded-full bg-[var(--color-primary-bg)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-primary)]">
              {milestones.length}
            </span>
          ) : null}
          <ChevronRightIcon
            className={`size-3.5 text-[var(--color-text-muted)] transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
            aria-hidden="true"
          />
        </button>
        {canManage ? (
          <button
            type="button"
            aria-label={t("milestoneAdd")}
            data-testid="project-milestone-add-trigger"
            disabled={adding}
            onClick={() => {
              setAdding(true);
              setCollapsed(false);
            }}
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <CollapseReveal open={!collapsed}>
        <ProjectMilestonesSection
          space={space}
          projectId={projectId}
          milestones={milestones}
          canManage={canManage}
          compact
          progress={progress}
          adding={adding}
          onAddingChange={setAdding}
        />
      </CollapseReveal>
    </section>
  );
}
