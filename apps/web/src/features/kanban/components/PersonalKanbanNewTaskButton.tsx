"use client";

import type { Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";
import { NewTaskModal } from "@/features/personal/tasks/components/NewTaskModal";

/** 个人空间 Kanban 页头「新建任务」：复用个人项目的空间级新建弹窗。 */
export function PersonalKanbanNewTaskButton({
  projects,
  defaultProjectId,
  tagPool,
}: {
  projects: { id: string; name: string }[];
  /** 当前 URL 筛选的项目；作为弹窗默认选中项（可改）。 */
  defaultProjectId?: string;
  /** 本人 task 标签池（必传——缺省空池会渲染假空态）。 */
  tagPool: Tag[];
}) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* testid 与项目页/弹窗系新建任务按钮同名字面量（e2e 契约见 utils/testids.ts）。 */}
      <Button data-testid="new-task-button" onClick={() => setOpen(true)}>
        {t("newTaskButton")}
      </Button>

      <NewTaskModal
        open={open}
        projects={projects}
        defaultProjectId={defaultProjectId}
        tagPool={tagPool}
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
