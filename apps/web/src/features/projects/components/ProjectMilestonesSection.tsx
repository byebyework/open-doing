"use client";

import type { ProjectMilestone } from "@open-doing/types";
import { CheckIcon, FlagIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import {
  addPersonalProjectMilestoneAction,
  deletePersonalProjectMilestoneAction,
  updatePersonalProjectMilestoneAction,
} from "@/features/personal/projects/actions";
import {
  addTeamProjectMilestoneAction,
  deleteTeamProjectMilestoneAction,
  updateTeamProjectMilestoneAction,
} from "../actions";
import { MilestoneDatePopover } from "./MilestoneDatePopover";
import {
  ProjectMilestoneEditor,
  type MilestoneDraftInput,
} from "./ProjectMilestoneEditor";
import type { ProjectFormSpace } from "./ProjectForm";

export interface ProjectMilestonesSectionProps {
  space: ProjectFormSpace;
  projectId: string;
  /** RSC 注入（dueDate ASC NULLS LAST 排序）。 */
  milestones: ProjectMilestone[];
  /** 团队 owner/admin、个人 owner 才为 true。 */
  canManage: boolean;
  /** 增删成功后的附加回调（嵌入 Drawer 等自有数据面时重取列表）。 */
  onChanged?: () => void;
  /**
   * 紧凑模式（右侧栏卡内）：隐藏内部标题行，加号即用的行内创建
   * （名称必填、日期可选），不使用完整编辑卡。
   */
  compact?: boolean;
  /** 里程碑进度（compact 行右侧「n 任务 · x%」；可缺省）。 */
  progress?: Record<string, { taskCount: number; doneCount: number; percent: number }>;
}

/**
 * 项目详情页里程碑区块（对照 spec：单一管理面——编辑弹窗不含里程碑）。
 *
 * 节点行 = 旗帜图标 + 名称 + 时间节点 + 描述一行；canManage 才有
 * 「添加」入口（展开 Linear 式编辑卡）与逐行「删除」（ConfirmModal
 * 二次确认，失败保持弹窗）。删除成功静默 + refresh（严格极简）。
 */
export function ProjectMilestonesSection({
  space,
  projectId,
  milestones,
  canManage,
  onChanged,
  compact = false,
  progress,
}: ProjectMilestonesSectionProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [inlineName, setInlineName] = useState("");
  const [inlineDue, setInlineDue] = useState("");
  /** 行点击编辑的里程碑 id（编辑组件 = 新建组件 + 预填数据）。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMilestone | null>(null);
  const [deleting, setDeleting] = useState(false);

  const addMilestone = async (draft: MilestoneDraftInput) => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const result =
        space.kind === "team"
          ? await addTeamProjectMilestoneAction({
              teamId: space.teamId,
              projectId,
              name: draft.name,
              description: draft.description,
              dueDate: draft.dueDate,
            })
          : await addPersonalProjectMilestoneAction(projectId, {
              name: draft.name,
              description: draft.description,
              dueDate: draft.dueDate,
            });

      if (!result.ok) {
        toast.error(result.errors.form ?? result.errors.milestones ?? tErrors("operationFailed"));
        return;
      }

      setAdding(false);
      onChanged?.();
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  const updateMilestone = async (
    milestoneId: string,
    input: { name?: string; description?: string; dueDate?: string | null },
  ) => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const result =
        space.kind === "team"
          ? await updateTeamProjectMilestoneAction({ teamId: space.teamId, projectId, milestoneId, ...input })
          : await updatePersonalProjectMilestoneAction(projectId, milestoneId, input);

      if (!result.ok) {
        toast.error(result.errors.form ?? result.errors.milestones ?? tErrors("operationFailed"));
        return;
      }

      setEditingId(null);
      onChanged?.();
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteMilestone = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);

    try {
      const result =
        space.kind === "team"
          ? await deleteTeamProjectMilestoneAction({
              teamId: space.teamId,
              projectId,
              milestoneId: deleteTarget.id,
            })
          : await deletePersonalProjectMilestoneAction(projectId, deleteTarget.id);

      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return;
      }

      setDeleteTarget(null);
      onChanged?.();
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      data-testid="project-milestones-section"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4"
    >
      {!compact ? (
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-[var(--ink-900)]">
            {t("milestoneSectionTitle")}
          </h2>
          {milestones.length > 0 ? (
            <span className="rounded-full bg-[var(--color-primary-bg)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-primary)]">
              {t("milestoneCount", { count: milestones.length })}
            </span>
          ) : null}
          {canManage && !adding ? (
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              data-testid="project-milestone-add-trigger"
              onClick={() => setAdding(true)}
            >
              <PlusIcon className="size-4" aria-hidden="true" />
              {t("milestoneAdd")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-end">
          {canManage && !adding ? (
            <button
              type="button"
              aria-label={t("milestoneAdd")}
              data-testid="project-milestone-add-trigger"
              disabled={submitting}
              onClick={() => setAdding(true)}
              className="inline-flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              <PlusIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}

      {adding && canManage ? (
        compact ? (
          <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-inset)] px-3 py-2">
            <span
              className="inline-block size-2.5 shrink-0 rotate-45 rounded-[2px] border border-[var(--color-text-muted)]"
              aria-hidden="true"
            />
            <Input
              autoFocus
              value={inlineName}
              maxLength={50}
              placeholder={t("milestoneNameLabel")}
              data-testid="project-milestone-inline-name"
              onChange={(event) => setInlineName(event.target.value)}
              disabled={submitting}
              className="h-8 min-w-0 flex-1 border-none bg-transparent px-1 text-[13px] font-medium shadow-none focus-visible:ring-0"
            />
            <Input
              type="date"
              value={inlineDue}
              aria-label={t("milestoneDueDateLabel")}
              data-testid="project-milestone-inline-due"
              onChange={(event) => setInlineDue(event.target.value)}
              disabled={submitting}
              className="h-7 w-[140px] shrink-0 rounded-full border-[var(--border)] bg-[var(--card)] px-3 text-[12.5px] tabular-nums"
            />
            <button
              type="button"
              aria-label={tCommon("cancel")}
              disabled={submitting}
              onClick={() => {
                setAdding(false);
                setInlineName("");
                setInlineDue("");
              }}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={tCommon("save")}
              data-testid="project-milestone-inline-confirm"
              disabled={submitting || inlineName.trim().length === 0}
              onClick={async () => {
                await addMilestone({
                  name: inlineName.trim(),
                  description: undefined,
                  dueDate: inlineDue,
                });
                setAdding(false);
                setInlineName("");
                setInlineDue("");
              }}
              className="text-[var(--color-primary)] disabled:opacity-50"
            >
              <CheckIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <ProjectMilestoneEditor
              onSubmit={addMilestone}
              onCancel={() => setAdding(false)}
              submitting={submitting}
              testIdPrefix="project"
            />
          </div>
        )
      ) : null}

      <ul className="mt-3 flex flex-col">
        {milestones.map((item, index) =>
          canManage && editingId === item.id ? (
            <li key={item.id} className="border-b border-[var(--border)] py-2 last:border-b-0">
              <ProjectMilestoneEditor
                initial={{ name: item.name, description: item.description, dueDate: item.dueDate ?? "" }}
                onSubmit={(draft) => {
                  void updateMilestone(item.id, draft);
                }}
                onCancel={() => setEditingId(null)}
                submitting={submitting}
                testIdPrefix="project"
                submitLabel={tCommon("save")}
              />
            </li>
          ) : (
            <li
              key={item.id}
              className="flex items-start gap-2.5 border-b border-[var(--border)] py-2.5 last:border-b-0"
            >
              <FlagIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {canManage ? (
                    <button
                      type="button"
                      data-testid={`project-milestone-edit-${index}`}
                      className="cursor-pointer text-[13px] font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]"
                      disabled={submitting}
                      onClick={() => setEditingId(item.id)}
                    >
                      {item.name}
                    </button>
                  ) : (
                    <span className="text-[13px] font-medium text-[var(--color-text)]">{item.name}</span>
                  )}
                  {item.dueDate ? (
                    <span className="rounded-full bg-[var(--color-todo-bg)] px-2 py-0.5 text-[11.5px] tabular-nums text-[var(--color-todo)]">
                      {item.dueDate}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-muted)]">
                  {item.description ?? "-"}
                </p>
                {progress?.[item.id] ? (
                  <p className="mt-0.5 text-[12px] tabular-nums text-[var(--color-text-muted)]">
                    {t("milestoneProgressMeta", {
                      count: progress[item.id]!.taskCount,
                      percent: progress[item.id]!.percent,
                    })}
                  </p>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  {/* 行内日期：Popover 日历直接设/改，不必进编辑态。 */}
                  <MilestoneDatePopover
                    value={item.dueDate ?? ""}
                    onChange={(dueDate) => void updateMilestone(item.id, { dueDate })}
                    disabled={submitting}
                    testid={`project-milestone-date-${index}`}
                  />
                  <button
                    type="button"
                    aria-label={t("milestoneDelete")}
                    data-testid={`project-milestone-delete-${index}`}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                    onClick={() => setDeleteTarget(item)}
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </li>
          ),
        )}
        {milestones.length === 0 && !adding ? (
          <li className="py-2 text-[12.5px] text-[var(--color-text-muted)]">-</li>
        ) : null}
      </ul>

      <ConfirmModal
        open={deleteTarget !== null}
        title={t("milestoneDelete")}
        content={deleteTarget?.name ?? ""}
        confirmText={tCommon("delete")}
        danger
        loading={deleting}
        onConfirm={deleteMilestone}
        onCancel={() => setDeleteTarget(null)}
        okButtonProps={{ "data-testid": "project-milestone-delete-confirm" }}
      />
    </section>
  );
}
