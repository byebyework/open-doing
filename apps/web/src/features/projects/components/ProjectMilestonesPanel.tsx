"use client";

import { useTranslations } from "next-intl";

import { ProjectMilestonesSection } from "./ProjectMilestonesSection";
import type { ProjectMilestone } from "@open-doing/types";
import { type ProjectFormSpace } from "./ProjectForm";

export interface ProjectMilestonesPanelProps {
  space: ProjectFormSpace;
  projectId: string;
  milestones: ProjectMilestone[];
  canManage: boolean;
}

/** 右侧 Milestones 卡：标题 + 复用 ProjectMilestonesSection（增删改）。 */
export function ProjectMilestonesPanel({
  space,
  projectId,
  milestones,
  canManage,
}: ProjectMilestonesPanelProps) {
  const t = useTranslations("projects");

  return (
    <section
      data-testid="project-milestones-panel"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <p className="mb-2 text-[13px] font-semibold text-[var(--ink-900)]">
        {t("milestoneSectionTitle")}
      </p>
      <ProjectMilestonesSection
        space={space}
        projectId={projectId}
        milestones={milestones}
        canManage={canManage}
      />
    </section>
  );
}
