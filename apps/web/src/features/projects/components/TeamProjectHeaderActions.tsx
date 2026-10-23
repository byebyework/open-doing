"use client";

import { Button, Modal, message } from "antd";
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
        message.error(result.errors.form ?? "删除失败，请稍后重试");
        return;
      }

      message.success("项目已删除");
      setDeleteOpen(false);
      router.push(redirectTo);
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button onClick={() => setEditOpen(true)}>编辑</Button>
      <Button danger onClick={() => setDeleteOpen(true)}>
        删除
      </Button>

      <Modal
        open={editOpen}
        title="编辑项目"
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
            message.success("已保存");
            setEditOpen(false);
            router.refresh();
          }}
        />
      </Modal>

      <ConfirmModal
        open={deleteOpen}
        title="删除项目"
        content="删除后项目下的任务、子任务与评论一并删除，且不可恢复。确定删除吗？"
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
