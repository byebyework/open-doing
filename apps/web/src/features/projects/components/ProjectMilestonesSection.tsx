"use client";

import type { ProjectMilestone } from "@open-doing/types";
import { FlagIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import {
  addPersonalProjectMilestoneAction,
  deletePersonalProjectMilestoneAction,
} from "@/features/personal/projects/actions";
import {
  addTeamProjectMilestoneAction,
  deleteTeamProjectMilestoneAction,
} from "../actions";
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
}: ProjectMilestonesSectionProps) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
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

      {adding && canManage ? (
        <div className="mt-3">
          <ProjectMilestoneEditor
            onSubmit={addMilestone}
            onCancel={() => setAdding(false)}
            submitting={submitting}
            testIdPrefix="project"
          />
        </div>
      ) : null}

      <ul className="mt-3 flex flex-col">
        {milestones.map((item, index) => (
          <li
            key={item.id}
            className="flex items-start gap-2.5 border-b border-[var(--border)] py-2.5 last:border-b-0"
          >
            <FlagIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[var(--color-text)]">
                  {item.name}
                </span>
                {item.dueDate ? (
                  <span className="rounded-full bg-[var(--color-todo-bg)] px-2 py-0.5 text-[11.5px] tabular-nums text-[var(--color-todo)]">
                    {item.dueDate}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-muted)]">
                {item.description ?? "-"}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                data-testid={`project-milestone-delete-${index}`}
                className="shrink-0 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                onClick={() => setDeleteTarget(item)}
              >
                {t("milestoneDelete")}
              </button>
            ) : null}
          </li>
        ))}
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
