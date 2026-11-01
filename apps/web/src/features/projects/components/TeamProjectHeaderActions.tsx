"use client";

import { Button, Modal, message } from "antd";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

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
        message.error(result.errors.form ?? t("deleteFailed"));
        return;
      }

      message.success(t("projectDeleted"));
      setDeleteOpen(false);
      router.push(redirectTo);
      router.refresh();
    } catch {
      message.error(tCommon("networkError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button onClick={() => setEditOpen(true)}>{tCommon("edit")}</Button>
      <Button danger onClick={() => setDeleteOpen(true)}>
        {tCommon("delete")}
      </Button>

      <Modal
        open={editOpen}
        title={t("editProject")}
        footer={null}
        onCancel={() => setEditOpen(false)}
        destroyOnHidden
        width={520}
      >
        <TeamProjectForm
          teamId={teamId}
          project={project}
          onCancel={() => setEditOpen(false)}
          onSuccess={() => {
            message.success(t("saved"));
            setEditOpen(false);
            router.refresh();
          }}
        />
      </Modal>

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
