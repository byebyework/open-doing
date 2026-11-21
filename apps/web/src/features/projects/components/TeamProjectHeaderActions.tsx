"use client";

import type { ProjectMemberRef, Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";

import type { ProjectFormProject } from "./ProjectForm";
import { TeamProjectForm } from "./TeamProjectForm";

/** 项目页页头操作区入参（页头已按角色决定是否渲染本组件）。 */
export interface TeamProjectHeaderActionsProps {
  teamId: string;
  /** 须含起止时间与优先级（共享表单编辑保存防误清空）。 */
  project: ProjectFormProject;
  /** 项目类型标签池（编辑弹层打标用）。 */
  projectTagPool?: Tag[];
  /** 团队成员池（负责人/成员 pill 数据源）。 */
  memberPool?: ProjectMemberRef[];
}

/**
 * 团队项目页头的「编辑」入口（仅 owner/admin 渲染）。
 * 删除入口只在项目列表（行内删除 + 二次确认）。
 */
export function TeamProjectHeaderActions({
  teamId,
  project,
  projectTagPool,
  memberPool,
}: TeamProjectHeaderActionsProps) {
  const router = useRouter();
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="outline"
        data-testid="team-project-edit-trigger"
        onClick={() => setEditOpen(true)}
      >
        {tCommon("edit")}
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
            projectTagPool={projectTagPool}
            memberPool={memberPool}
            onCancel={() => setEditOpen(false)}
            onSuccess={() => {
              toast.success(t("saved"));
              setEditOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
