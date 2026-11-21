"use client";

import type { Project, ProjectMemberRef, Tag } from "@open-doing/types";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { teamProjectHref } from "@/lib/routes";

import { ProjectForm } from "./ProjectForm";

/** 团队项目表单入参：传 `project` 即编辑态，否则新建。 */
export interface TeamProjectFormProps {
  teamId: string;
  project?: {
    id: string;
    name: string;
    description?: string;
    startDate?: string | null;
    endDate?: string | null;
    priority?: Project["priority"];
    tags?: Tag[];
  };
  /** 成功后回调（页面跳转 / 弹窗关闭由调用方决定）。 */
  onSuccess: (project: Project) => void;
  /** 取消（编辑弹窗内使用）。 */
  onCancel?: () => void;
  /** 项目类型标签池（RSC 注入；打标入口，空池不渲染）。 */
  projectTagPool?: Tag[];
  /** 团队成员池（RSC 注入；负责人/成员 pill 数据源）。 */
  memberPool?: ProjectMemberRef[];
}

/**
 * 团队项目表单（新建与编辑共用）：共享 `ProjectForm` 的团队空间薄壳。
 * 字段错误按 `field` 回填到表单项，表单级错误在顶部展示；提交中禁用表单。
 */
export function TeamProjectForm({
  teamId,
  project,
  onSuccess,
  onCancel,
  projectTagPool = [],
  memberPool,
}: TeamProjectFormProps) {
  return (
    <ProjectForm
      space={{ kind: "team", teamId }}
      project={project}
      projectTagPool={projectTagPool}
      memberPool={memberPool}
      onSuccess={onSuccess}
      onCancel={onCancel}
      testIdPrefix="team-project"
    />
  );
}

/**
 * 「新建项目」页的 client 包装件：成功后跳到新项目页。
 */
export function TeamProjectCreatePanel({
  teamId,
  teamSlug,
  projectTagPool = [],
  memberPool,
}: {
  teamId: string;
  teamSlug: string;
  /** 项目类型标签池（RSC 注入；空池不渲染标签区）。 */
  projectTagPool?: Tag[];
  /** 团队成员池（RSC 注入）。 */
  memberPool?: ProjectMemberRef[];
}) {
  const router = useRouter();
  const t = useTranslations("projects");

  return (
    <ProjectForm
      space={{ kind: "team", teamId }}
      projectTagPool={projectTagPool}
      memberPool={memberPool}
      onSuccess={(project) => {
        toast.success(t("projectCreated"));
        router.push(teamProjectHref(teamSlug, project.slug));
        router.refresh();
      }}
      testIdPrefix="team-project"
    />
  );
}
