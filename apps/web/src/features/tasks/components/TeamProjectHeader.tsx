"use client";

import type { Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";
import type { ProjectFormProject } from "@/features/projects/components/ProjectForm";

import { NewTeamTaskModal } from "./NewTeamTaskModal";

/** 页头操作区入参。 */
export interface TeamProjectHeaderProps {
  teamId: string;
  project: ProjectFormProject;
  /** 新建任务弹窗可选项目（仅本团队）。 */
  projects: { id: string; name: string }[];
  /** 团队成员（新建任务责任人下拉）。 */
  members: { id: string; name: string }[];
  /** 当前用户（新建任务默认责任人）。 */
  actorId: string;
  /** 本团队任务标签池（type='task'；新建任务弹窗用）。 */
  tagPool?: Tag[];
}

/**
 * 团队项目页页头操作区：主按钮「＋ 新建任务」。
 *
 * 任务列表 / 看板在团队任务模块（`/space/{teamSlug}/tasks`）；项目页仅概览，
 * 新建任务弹窗默认选中当前项目。
 * （项目编辑 / 删除入口在概览面板内联编辑与项目列表；负责人 / 成员 /
 * 标签等协作字段同样内联在概览面板。）
 */
export function TeamProjectHeader({
  teamId,
  project,
  projects,
  members,
  actorId,
  tagPool,
}: TeamProjectHeaderProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button data-testid="new-task-button" onClick={() => setNewTaskOpen(true)}>
        {t("newTaskButton")}
      </Button>

      <NewTeamTaskModal
        open={newTaskOpen}
        teamId={teamId}
        tagPool={tagPool}
        projects={projects}
        defaultProjectId={project.id}
        members={members}
        defaultAssigneeId={actorId}
        onSuccess={() => {
          setNewTaskOpen(false);
          router.refresh();
        }}
        onCancel={() => setNewTaskOpen(false)}
      />
    </div>
  );
}
