"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import { spaceDashboardHref } from "@/lib/routes";

import { deletePersonalProjectAction } from "../actions";
import { PersonalProjectFormModal } from "./PersonalProjectFormModal";

export interface PersonalProjectHeaderActionsProps {
  project: { id: string; name: string; description?: string };
}

/**
 * 项目占位页的「编辑 / 删除」操作区（P-3 会替换为完整项目页操作区）。
 *
 * 编辑复用 PersonalProjectFormModal；删除走 ConfirmModal 二次确认，
 * 成功后回到「我的任务」。
 */
export function PersonalProjectHeaderActions({
  project,
}: PersonalProjectHeaderActionsProps) {
  const router = useRouter();
  const t = useTranslations("personal");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [editOpen, setEditOpen] = useState(false);
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
      <Button variant="ghost" onClick={() => setEditOpen(true)}>
        {tCommon("edit")}
      </Button>
      <Button variant="ghost" className="text-destructive" onClick={() => setDeleteOpen(true)}>
        {tCommon("delete")}
      </Button>

      <PersonalProjectFormModal
        open={editOpen}
        mode="edit"
        project={project}
        onSuccess={() => {
          setEditOpen(false);
          router.refresh();
        }}
        onCancel={() => setEditOpen(false)}
      />

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
