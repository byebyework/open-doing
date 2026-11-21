"use client";

import type { Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/shadcn/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import type { ProjectMemberRef } from "@open-doing/types";
import type { ProjectFormProject } from "@/features/projects/components/ProjectForm";

import { NewTeamTaskModal } from "./NewTeamTaskModal";

/** 团队项目页视图。 */
export type TeamProjectView = "overview" | "list" | "board";

/** 页头操作区入参。 */
export interface TeamProjectHeaderProps {
  teamId: string;
  project: ProjectFormProject;
  /** 项目页路径（写 `?view=` 用）。 */
  projectPath: string;
  /** 当前视图。 */
  view: TeamProjectView;
  /** 新建任务弹窗可选项目（仅本团队）。 */
  projects: { id: string; name: string }[];
  /** 团队成员（新建任务责任人下拉）。 */
  members: { id: string; name: string }[];
  /** 当前用户（新建任务默认责任人）。 */
  actorId: string;
  /** owner / admin 才渲染项目编辑与删除入口。 */
  canManage: boolean;
  /** 删除项目成功后的跳转地址。 */
  redirectTo: string;
  /** 本团队任务标签池（type='task'；新建任务弹窗用）。 */
  tagPool?: Tag[];
  /** 项目类型标签池（type='project'；编辑弹层打标用）。 */
  projectTagPool?: Tag[];
  /** 团队名册（负责人/成员编辑弹层数据源；可含未入项目的成员）。 */
  memberPool?: ProjectMemberRef[];
  /** 项目当前负责人（meta 行展示）。 */
  displayLead?: ProjectMemberRef | null;
  /** 项目当前成员（meta 行展示）。 */
  displayMembers?: ProjectMemberRef[];
}

/**
 * 团队项目页页头操作区：
 * 「编辑 / 删除」（仅 owner/admin）→ Segmented「列表 / 看板」→「＋ 新建任务」。
 */
export function TeamProjectHeader({
  teamId,
  project,
  projectPath,
  view,
  projects,
  members,
  actorId,
  canManage,
  redirectTo,
  tagPool,
  projectTagPool,
  memberPool,
  displayLead,
  displayMembers,
}: TeamProjectHeaderProps) {
  const router = useRouter();
  const t = useTranslations("tasks");
  const tProjects = useTranslations("projects");
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // meta 行展示项目当前成员（与编辑弹层的名册池关注点分离）

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {/* tabs 靠左（概览/任务/看板）；编辑/删除/状态/协作字段已移至内联编辑与列表操作列 */}
      <Tabs value={view} onValueChange={(nextView) => router.push(`${projectPath}?view=${nextView}`)}>
        <TabsList>
          <TabsTrigger value="overview">{t("viewOverview")}</TabsTrigger>
          <TabsTrigger value="list">{t("viewList")}</TabsTrigger>
          <TabsTrigger value="board">{t("viewBoard")}</TabsTrigger>
        </TabsList>
      </Tabs>

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
