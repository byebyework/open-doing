"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";
import { NewTeamTaskModal } from "@/features/tasks/components/NewTeamTaskModal";
import type { Tag } from "@open-doing/types";

/** 团队空间任务页头「新建任务」：复用团队新建任务弹窗（成员均可见）。 */
export function TeamTasksNewTaskButton({
  teamId,
  projects,
  defaultProjectId,
  members,
  defaultAssigneeId,
  tagPool,
}: {
  teamId: string;
  /** 可选的团队项目（当前空间可见范围）。 */
  projects: { id: string; name: string }[];
  /** 当前 URL 筛选的项目；作为弹窗默认选中项（可改）。 */
  defaultProjectId?: string | null;
  /** 可指派的团队成员。 */
  members: { id: string; name: string }[];
  /** 默认责任人（通常为当前用户）。 */
  defaultAssigneeId?: string | null;
  /** 本团队任务类型标签池（RSC 注入；为空时弹窗不渲染标签选择区）。 */
  tagPool: Tag[];
}) {
  const router = useRouter();
  const t = useTranslations("kanban");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("newTaskButton")}</Button>

      <NewTeamTaskModal
        open={open}
        teamId={teamId}
        projects={projects}
        defaultProjectId={defaultProjectId}
        members={members}
        defaultAssigneeId={defaultAssigneeId}
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
