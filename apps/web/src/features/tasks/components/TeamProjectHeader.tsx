"use client";

import { Button, Segmented } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { TeamProjectHeaderActions } from "@/features/projects/components/TeamProjectHeaderActions";

import { NewTeamTaskModal } from "./NewTeamTaskModal";

/** 团队项目页视图。 */
export type TeamProjectView = "list" | "board";

/** 页头操作区入参。 */
export interface TeamProjectHeaderProps {
  teamId: string;
  project: { id: string; name: string; description?: string };
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
}: TeamProjectHeaderProps) {
  const router = useRouter();
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {canManage ? (
        <TeamProjectHeaderActions
          teamId={teamId}
          project={project}
          redirectTo={redirectTo}
        />
      ) : null}

      <Segmented<TeamProjectView>
        options={[
          { label: "列表", value: "list" },
          { label: "看板", value: "board" },
        ]}
        value={view}
        onChange={(nextView) => {
          router.push(`${projectPath}?view=${nextView}`);
        }}
      />

      <Button type="primary" onClick={() => setNewTaskOpen(true)}>
        ＋ 新建任务
      </Button>

      <NewTeamTaskModal
        open={newTaskOpen}
        teamId={teamId}
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
