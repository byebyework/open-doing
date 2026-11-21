"use client";

import type { ProjectFormProject } from "@/features/projects/components/ProjectForm";
import type { Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { spaceDashboardHref } from "@/lib/routes";

import { deletePersonalProjectAction } from "../actions";

export interface PersonalProjectHeaderActionsProps {
  /** 当前项目（编辑复用共享 ProjectForm；须含起止时间与优先级防误清空）。 */
  project: ProjectFormProject;
  /** 项目类型标签池（编辑弹层打标用）。 */
  projectTagPool?: Tag[];
}

/**
 * 个人项目页的「编辑 / 删除」操作区。
 *
 * 编辑弹窗包共享 `ProjectForm`（open 作 exit-hold 幂等闸）；删除走
 * ConfirmModal 二次确认，成功后回到「我的任务」。
 */
export function PersonalProjectHeaderActions({
  project,
  projectTagPool,
}: PersonalProjectHeaderActionsProps) {
  const router = useRouter();
  const t = useTranslations("personal");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);

    try {
      const result = await deletePersonalProjectAction(project.id);

      if (!result.ok) {
        toast.error(result.errors.form ?? Object.values(result.errors)[0] ?? tErrors("operationFailed"));
        return;
      }

      toast.success(t("projectDeleted"));
      setDeleteOpen(false);
      router.push(spaceDashboardHref("personal"));
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" className="text-destructive" onClick={() => setDeleteOpen(true)}>
        {tCommon("delete")}
      </Button>

      <ConfirmModal
        open={deleteOpen}
        title={t("deleteTitle")}
        content={t("deleteConfirm", { name: project.name })}
        confirmText={tCommon("delete")}
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
