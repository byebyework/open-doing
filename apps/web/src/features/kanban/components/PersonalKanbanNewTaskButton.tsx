"use client";

import { Button } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { NewTaskModal } from "@/features/personal/tasks/components/NewTaskModal";

/** 个人空间 Kanban 页头「新建任务」：复用个人项目的空间级新建弹窗。 */
export function PersonalKanbanNewTaskButton({
  projects,
  defaultProjectId,
}: {
  projects: { id: string; name: string }[];
  /** 当前 URL 筛选的项目；作为弹窗默认选中项（可改）。 */
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="primary" onClick={() => setOpen(true)}>
        ＋ 新建任务
      </Button>

      <NewTaskModal
        open={open}
        projects={projects}
        defaultProjectId={defaultProjectId}
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
