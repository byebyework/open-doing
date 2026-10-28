import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import {
  getPersonalProjectBySlug,
  listPersonalProjects,
} from "@/features/personal/projects/service";
import { PersonalProjectPageActions } from "@/features/personal/tasks/components/TaskRowActions";
import { PersonalKanban } from "@/features/personal/tasks/components/PersonalKanban";
import { ProjectTaskTable } from "@/features/personal/tasks/components/ProjectTaskTable";
import { listPersonalProjectTasks } from "@/features/personal/tasks/service";
import { personalProjectHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

/** 视图切换参数：缺省（或其他值）一律按列表处理。 */
type ProjectView = "list" | "board";

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
  const requestedView = Array.isArray(viewParam) ? viewParam[0] : viewParam;
  const view: ProjectView = requestedView === "board" ? "board" : "list";

  const user = await requireUser();
  const project = await getPersonalProjectBySlug(user.id, projectSlug);

  if (!project) notFound();

  const [tasks, projects] = await Promise.all([
    listPersonalProjectTasks(user.id, project.id),
    listPersonalProjects(user.id),
  ]);

  const projectOptions = projects.map(({ id, name }) => ({ id, name }));
  const today = todayInShanghai();
  const projectPath = personalProjectHref(project.slug);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <nav
        aria-label="面包屑"
        className="flex min-w-0 items-center gap-2 text-[13px] text-[#9aa0a6]"
      >
        <span className="shrink-0">个人空间</span>
        <span aria-hidden="true">/</span>
        <strong className="truncate font-semibold text-[#0e1318]">
          {project.name}
        </strong>
      </nav>

      <header className="mt-2 flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            {project.name}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[#5f6368]">
            {view === "board"
              ? "拖动卡片即可改变任务状态（手动切换）"
              : `个人项目 · 仅自己可见 · ${tasks.length} 个任务`}
          </p>
        </div>

        <PersonalProjectPageActions
          project={{
            id: project.id,
            name: project.name,
            description: project.description,
          }}
          projectPath={projectPath}
          view={view}
          projects={projectOptions}
        />
      </header>

      <div className="mt-5">
        {view === "board" ? (
          <PersonalKanban
            tasks={tasks}
            today={today}
            projectId={project.id}
            projects={projectOptions}
          />
        ) : (
          <ProjectTaskTable
            tasks={tasks}
            today={today}
            projectId={project.id}
            projects={projectOptions}
          />
        )}
      </div>
    </div>
  );
}
