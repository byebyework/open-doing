"use client";

import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

import { deletePersonalProjectAction } from "../actions";
import { PersonalProjectFormModal } from "./PersonalProjectFormModal";

export interface PersonalProjectHeaderActionsProps {
  project: { id: string; name: string; description?: string };
}

function firstError(errors: Record<string, string>): string {
  return errors.form ?? Object.values(errors)[0] ?? "操作失败，请稍后重试";
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
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);

    try {
      const result = await deletePersonalProjectAction(project.id);

      if (!result.ok) {
        message.error(firstError(result.errors));
        return;
      }

      message.success("项目已删除");
      setDeleteOpen(false);
      router.push("/my");
      router.refresh();
    } catch {
      message.error("网络异常，请稍后重试");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="text" onClick={() => setEditOpen(true)}>
        编辑
      </Button>
      <Button type="text" danger onClick={() => setDeleteOpen(true)}>
        删除
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
        title="删除项目"
        content={`删除后项目内任务一并删除，且不可恢复。确定删除「${project.name}」吗？`}
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
