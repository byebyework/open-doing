import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import {
  getPersonalProjectBySlug,
  listPersonalProjects,
} from "@/features/personal/projects/service";
import { ProjectDetailLayout } from "@/features/projects/components/ProjectDetailLayout";
import { ProjectMilestonesPanel } from "@/features/projects/components/ProjectMilestonesPanel";
import { ProjectOverviewPanel } from "@/features/projects/components/ProjectOverviewPanel";
import { ProjectPropertiesPanel } from "@/features/projects/components/ProjectPropertiesPanel";
import { listPersonalProjectMilestonesWithProgress } from "@/features/personal/projects/service";
import { PersonalProjectPageActions } from "@/features/personal/tasks/components/TaskRowActions";
import { listTags } from "@/features/tags/service";
import { PersonalKanban } from "@/features/personal/tasks/components/PersonalKanban";
import { ProjectTaskTable } from "@/features/personal/tasks/components/ProjectTaskTable";
import { listPersonalProjectTasks } from "@/features/personal/tasks/service";
import { personalProjectHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

/** 视图切换参数：缺省（或其他值）一律按列表处理。 */
type ProjectView = "overview" | "list" | "board";

interface PersonalProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ projectSlug: string }>;
  /** Next 16：searchParams 同样为 Promise。 */
  searchParams: Promise<{ view?: string | string[] }>;
}

/**
 * 个人项目页（P-3）：列表 + 看板双视图。
 *
 * 页面本身保持 RSC：服务端读取项目、项目任务与全部个人项目；
 * 交互（视图切换、新建任务、行内操作、拖拽）全部下沉到 `"use client"` 组件。
 * 非本人或不存在一律 404，不泄露存在性。
 */
export default async function PersonalProjectPage({
  params,
  searchParams,
}: PersonalProjectPageProps) {
  const { projectSlug } = await params;
  const { view: viewParam } = await searchParams;
  const t = await getTranslations("projects");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");
  const requestedView = Array.isArray(viewParam) ? viewParam[0] : viewParam;
  const view: ProjectView = requestedView === "board" || requestedView === "list" ? requestedView : "overview";

  const user = await requireUser();
  const project = await getPersonalProjectBySlug(user.id, projectSlug);

  if (!project) notFound();

  const [tasks, projects, tagPool] = await Promise.all([
    listPersonalProjectTasks(user.id, project.id),
    listPersonalProjects(user.id),
    listTags({ ownerId: user.id }),
  ]);
  const taskTagPool = tagPool.filter((tag) => tag.type === "task");
  const milestoneProgress = await listPersonalProjectMilestonesWithProgress(user.id, project.id);
  const projectTagPool = tagPool.filter((tag) => tag.type === "project");

  const projectOptions = projects.map(({ id, name }) => ({ id, name }));
  const today = todayInShanghai();
  const projectPath = personalProjectHref(project.slug);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <nav
        aria-label={tCommon("breadcrumb")}
        className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink-400)]"
      >
        <span className="shrink-0">{tNav("personalSpace")}</span>
        <span aria-hidden="true">/</span>
        <strong className="truncate font-semibold text-[var(--ink-900)]">
          {project.name}
        </strong>
      </nav>

      <PageHeader
        className="mt-2"
        title={view === "overview" ? undefined : project.name}
        subtitle={view === "overview" ? undefined : `${view === "board"
          ? t("boardDragHint")
          : t("personalProjectMeta", { tasks: tasks.length })}${project.startDate && project.endDate ? ` · ${t("dateRange")}: ${project.startDate} → ${project.endDate}` : ""}`}
        actions={
          <PersonalProjectPageActions
            project={{
              id: project.id,
              name: project.name,
              description: project.description,
              startDate: project.startDate,
              endDate: project.endDate,
              priority: project.priority,
              status: project.status,
              tags: project.tags,
            }}
            projectPath={projectPath}
            view={view}
            projects={projectOptions}
            projectTagPool={projectTagPool}
          />
        }
      />

      <ProjectDetailLayout
        sidebar={
          <>
            <ProjectPropertiesPanel
              project={project}
              memberPool={[]}
              canManage
              space={{ kind: "personal" }}
            />
            <ProjectMilestonesPanel
              space={{ kind: "personal" }}
              projectId={project.id}
              milestones={milestoneProgress.map((item) => item.milestone)}
              canManage
            />
          </>
        }
      >
        {view === "overview" ? (
          <div className="mt-5">
            <ProjectOverviewPanel
              project={project}
              actorId={user.id}
              milestones={milestoneProgress}
              memberPool={[]}
              displayLead={null}
              displayMembers={[]}
              canManage
              space={{ kind: "personal" }}
            />
          </div>
        ) : (
          <div className="mt-5">
            {view === "board" ? (
          <PersonalKanban
            tasks={tasks}
            today={today}
            projectId={project.id}
            projects={projectOptions}
            tagPool={taskTagPool}
          />
        ) : (
          <ProjectTaskTable
            tasks={tasks}
            today={today}
            projectId={project.id}
            projects={projectOptions}
            tagPool={taskTagPool}
          />
        )}
        </div>
      )}
      </ProjectDetailLayout>
    </div>
  );
}
