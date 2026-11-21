"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { ProjectMilestonesSection } from "./ProjectMilestonesSection";
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
  const prefersReducedMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      data-testid="project-milestones-panel"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <button
        type="button"
        data-testid="milestones-collapse"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className="mb-2 flex w-full cursor-pointer items-center gap-2 text-[13px] font-semibold text-[var(--ink-900)]"
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
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.div
            key="milestones-body"
            initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { height: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }, opacity: { duration: 0.16 } }
            }
            className="overflow-hidden"
          >
      <ProjectMilestonesSection
        space={space}
        projectId={projectId}
        milestones={milestones}
        canManage={canManage}
        compact
        progress={progress}
      />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
