"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";

import { deleteTeamProjectAction } from "../actions";
import { TeamProjectForm } from "./TeamProjectForm";

/** 项目页页头操作区入参（页头已按角色决定是否渲染本组件）。 */
export interface TeamProjectHeaderActionsProps {
  teamId: string;
  project: { id: string; name: string; description?: string };
  /** 删除成功后跳转地址（项目页已不存在）。 */
  redirectTo: string;
}

/**
 * 团队项目的「编辑 / 删除」入口（仅 owner/admin 渲染）。
 *
 * 删除走二次确认；成功后离开已删除的项目页。
 */
export function TeamProjectHeaderActions({
  teamId,
  project,
  redirectTo,
}: TeamProjectHeaderActionsProps) {
  const router = useRouter();
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);

    try {
      const result = await deleteTeamProjectAction({
        teamId,
        projectId: project.id,
      });

      if (!result.ok) {
        toast.error(result.errors.form ?? t("deleteFailed"));
        return;
      }

      toast.success(t("projectDeleted"));
      setDeleteOpen(false);
      router.push(redirectTo);
      router.refresh();
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" onClick={() => setEditOpen(true)}>
        {tCommon("edit")}
      </Button>
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
      >
        {tCommon("delete")}
      </Button>

      {/* Radix Dialog 在退出保持窗口（OD_MS.modalOut）结束后才卸载内容，
          编辑表单每次打开按 project 重建。 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("editProject")}</DialogTitle>
          </DialogHeader>
          <TeamProjectForm
            teamId={teamId}
            project={project}
            onCancel={() => setEditOpen(false)}
            onSuccess={() => {
              toast.success(t("saved"));
              setEditOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={deleteOpen}
        title={t("deleteProject")}
        content={t("deleteConfirm")}
        confirmText={tCommon("delete")}
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
