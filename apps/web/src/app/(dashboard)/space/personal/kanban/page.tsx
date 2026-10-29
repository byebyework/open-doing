import type { Metadata } from "next";

import { requireUser } from "@/features/auth/session";
import { SpaceKanban } from "@/features/kanban/components/SpaceKanban";
import { SpaceKanbanFilterBar } from "@/features/kanban/components/SpaceKanbanFilterBar";
import { PersonalKanbanNewTaskButton } from "@/features/kanban/components/PersonalKanbanNewTaskButton";
import { getPersonalSpaceBoard } from "@/features/kanban/service";
import { listPersonalProjects } from "@/features/personal/projects/service";
import { moduleHref, personalTaskHref } from "@/lib/routes";
import { todayInShanghai, weekdayLabel } from "@/lib/today";

export const metadata: Metadata = {
  title: "Kanban · Open Doing",
};

/**
 * 个人空间 Kanban（v1.1 M2）。
 *
 * RSC 取数：`?project={slug}` 命中本人项目时服务端过滤三列与 done 计数；
 * 未知 / 他人 slug 静默回退为全部（不 500、不报错）。筛选状态写回 URL 的
 * 交互下沉到 client 筛选条；看板组件只消费过滤后的数据。
 */
export default async function PersonalKanbanPage(
  props: PageProps<"/space/personal/kanban">,
) {
  const user = await requireUser();
  const today = todayInShanghai();
  const { project: projectParam } = await props.searchParams;
  const requestedSlug = Array.isArray(projectParam)
    ? projectParam[0]
    : projectParam;

  // 筛选条件依赖项目列表（slug → id），故先取项目再取看板。
  const projects = await listPersonalProjects(user.id);
  const activeProject = projects.find(
    (project) => project.slug === requestedSlug,
  );

  const board = await getPersonalSpaceBoard(
    user.id,
    today,
    activeProject ? { projectId: activeProject.id } : undefined,
  );

  const taskHrefs = Object.fromEntries(
    [...board.todo, ...board.inProgress, ...board.doneRecent].map((card) => [
      card.id,
      personalTaskHref(card.id),
    ]),
  );

  // 「N 个任务」= 当前筛选下的全部卡片（含窗口外已完成，doneTotal 已按筛选计算）。
  const total = board.todo.length + board.inProgress.length + board.doneTotal;
  const projectName = activeProject?.name ?? "全部项目";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <header className="flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
            Kanban
          </h1>
          <p className="mt-1.5 text-[14px] text-[#5f6368]">
            个人项目的任务全景：全部个人任务跨项目聚合，拖拽卡片即可切换状态。
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <PersonalKanbanNewTaskButton
            projects={projects.map(({ id, name }) => ({ id, name }))}
            defaultProjectId={activeProject?.id}
          />
        </div>
      </header>

      <SpaceKanbanFilterBar
        variant="personal"
        basePath={moduleHref("personal", "kanban")}
        projects={projects}
        activeProjectSlug={activeProject?.slug}
        caption={`当前筛选：${projectName} · ${total} 个任务`}
        todayCaption={`基准日期 ${today}（${weekdayLabel(today)}）`}
      />

      <div className="mt-5">
        <SpaceKanban
          variant="personal"
          board={board}
          projects={projects}
          today={today}
          taskHrefs={taskHrefs}
          expandFilter={
            activeProject ? { projectSlug: activeProject.slug } : undefined
          }
        />
      </div>
    </div>
  );
}
