"use client";

import type { ProjectMilestone } from "@open-doing/types";
import { ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { listPersonalProjectMilestonesAction } from "@/features/personal/projects/actions";
import { Button } from "@/components/ui/shadcn/button";
import { TagPill } from "@/features/tags/components/TagPill";
import { listTeamProjectMilestonesAction } from "../actions";
import { ProjectMilestonesSection } from "./ProjectMilestonesSection";
import type { ProjectFormSpace } from "./ProjectForm";
import type { ProjectListRow } from "./ProjectListTable";

/** Drawer 概览数据（ProjectListRow 加任务统计；RSC 侧组装）。 */
export type ProjectDrawerProject = ProjectListRow;

export interface ProjectDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: ProjectFormSpace;
  project: ProjectDrawerProject | null;
  /** 团队 owner/admin、个人 owner 才为 true（里程碑管理入口）。 */
  canManage: boolean;
}

/**
 * 项目详情右侧 Drawer（行点击打开；详情页保留给看板/任务表深工作）。
 *
 * 打开时按需拉取里程碑（避免列表页 N+1）；增删成功后经 `onChanged`
 * 重取列表。字段 pill 颜色全部走 token 变量。
 */
export function ProjectDetailDrawer({
  open,
  onOpenChange,
  space,
  project,
  canManage,
}: ProjectDetailDrawerProps) {
  const t = useTranslations("projects");
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);

  const projectId = project?.id;

  // 打开时按需拉取（setMilestones 在异步回调里触发，不合 effect 同步 setState 规则）。
  const reloadMilestones = useCallback(async () => {
    if (!projectId) return;
    const result =
      space.kind === "team"
        ? await listTeamProjectMilestonesAction({ teamId: space.teamId, projectId })
        : await listPersonalProjectMilestonesAction(projectId);
    if (result.ok) setMilestones(result.data);
  }, [space, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    // 首拉放到下一轮事件循环（同 NotificationBell 模式）：effect 体内同步触发
    // setState 会级联渲染，延迟后即属「订阅外部系统后在回调中更新状态」。
    const timer = window.setTimeout(() => void reloadMilestones(), 0);
    return () => window.clearTimeout(timer);
  }, [open, projectId, reloadMilestones]);

  if (!open || !project) return null;

  const statusLabel = t(
    project.statusKind === "not_started"
      ? "statusNotStarted"
      : project.statusKind === "in_progress"
        ? "statusInProgress"
        : "statusCompleted",
  );
  const statusClass =
    project.statusKind === "completed"
      ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
      : project.statusKind === "in_progress"
        ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]"
        : "border border-[var(--border)] bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)]";
  const priorityClass =
    project.priority === "high"
      ? "bg-[var(--color-error-bg)] text-[var(--color-error)]"
      : project.priority === "medium"
        ? "bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
        : "bg-[var(--color-todo-bg)] text-[var(--color-todo)]";
  const priorityLabel = t(
    project.priority === "high"
      ? "priorityHigh"
      : project.priority === "medium"
        ? "priorityMedium"
        : "priorityLow",
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[480px] flex-col gap-4 overflow-y-auto [scrollbar-width:none] p-5 sm:max-w-[480px] [&::-webkit-scrollbar]:hidden"
        data-testid="project-detail-drawer"
      >
        <SheetHeader className="gap-2 text-left">
          <div className="flex items-center gap-2">
            <SheetTitle className="min-w-0 truncate text-[18px]">{project.name}</SheetTitle>
            <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          {(project.summary ?? project.description) ? (
            <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
              {project.summary ?? project.description}
            </p>
          ) : null}
        </SheetHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div className="flex flex-col gap-1">
            <dt className="text-[12px] text-[var(--color-text-muted)]">{t("colDates")}</dt>
            <dd className="tabular-nums">
              {project.startDate && project.endDate
                ? `${project.startDate} ~ ${project.endDate}`
                : (project.startDate ?? project.endDate ?? "-")}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-[12px] text-[var(--color-text-muted)]">{t("colPriority")}</dt>
            <dd>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityClass}`}>
                {priorityLabel}
              </span>
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <dt className="text-[12px] text-[var(--color-text-muted)]">{t("colTags")}</dt>
            <dd>
              {project.tags.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {project.tags.map((tag) => (
                    <TagPill key={tag.id} name={tag.name} color={tag.color} />
                  ))}
                </span>
              ) : (
                <span className="text-[var(--color-text-muted)]">-</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[12px] text-[var(--color-text-muted)]">{t("colProgress")}</span>
            <span className="tabular-nums text-[var(--color-text-secondary)]">
              {project.progressPercent}%
            </span>
          </div>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-progress-bg)]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${project.progressPercent}%`,
                backgroundColor:
                  project.statusKind === "completed"
                    ? "var(--color-success)"
                    : project.progressPercent > 0
                      ? "var(--color-progress)"
                      : "transparent",
              }}
            />
          </span>
          <p className="text-[12px] tabular-nums text-[var(--color-text-muted)]">
            {t("drawerTasksLabel")} {project.taskCount} · {t("drawerDoneLabel")} {project.doneCount} ·{" "}
            {t("drawerOverdueLabel")} {project.overdueCount}
          </p>
        </div>

        <div className="min-h-0 flex-1">
          <ProjectMilestonesSection
            space={space}
            projectId={project.id}
            milestones={milestones}
            canManage={canManage}
            onChanged={() => void reloadMilestones()}
          />
        </div>

        <Button variant="outline" asChild>
          <a
            href={project.href}
            data-testid="project-drawer-full-page-link"
            onClick={() => onOpenChange(false)}
          >
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
            {t("openFullPage")}
          </a>
        </Button>
      </SheetContent>
    </Sheet>
  );
}
