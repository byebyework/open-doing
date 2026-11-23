import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { KanbanStatStrip } from "@/features/kanban/components/KanbanStatStrip";
import { SpaceKanban } from "@/features/kanban/components/SpaceKanban";
import { SpaceKanbanFilterBar } from "@/features/kanban/components/SpaceKanbanFilterBar";
import { PersonalKanbanNewTaskButton } from "@/features/kanban/components/PersonalKanbanNewTaskButton";
import { SpaceTaskTable } from "@/features/kanban/components/SpaceTaskTable";
import { sortTaskRows } from "@/features/kanban/sort-task-rows";
import { TasksViewTabs } from "@/features/kanban/components/TasksViewTabs";
import {
  getOlderDonePersonalTasks,
  getPersonalKanbanStats,
  getPersonalSpaceBoard,
} from "@/features/kanban/service";
import { parseStatFilterParams } from "@/features/kanban/stat-filter";
import { listPersonalProjects } from "@/features/personal/projects/service";
import { moduleHref, personalTaskHref } from "@/lib/routes";
import { WEEKDAY_KEYS, todayInShanghai, weekdayIndex } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("tasksTitle") };
}

/**
 * 个人空间任务（v1.1 M2，原 Kanban 模块改名）。
 *
 * RSC 取数：`?project={slug}` 命中本人项目时服务端过滤三列与 done 计数；
 * 未知 / 他人 slug 静默回退为全部（不 500、不报错）。筛选状态写回 URL 的
 * 交互下沉到 client 筛选条；看板组件只消费过滤后的数据。
 */
export default async function PersonalTasksPage(
  props: PageProps<"/space/personal/tasks">,
) {
  const t = await getTranslations("kanban");
  const tDate = await getTranslations("date");
  const tNav = await getTranslations("nav");
  const user = await requireUser();
  const today = todayInShanghai();
  const { project: projectParam, view: viewParam, ...statParams } =
    await props.searchParams;
  const requestedSlug = Array.isArray(projectParam)
    ? projectParam[0]
    : projectParam;
  // 双视图：`?view=list` 即列表，无 view（含非法值）回归看板默认。
  const requestedView = Array.isArray(viewParam) ? viewParam[0] : viewParam;
  const initialView = requestedView === "list" ? "list" : "board";
  const statFilter = parseStatFilterParams(statParams);

  // 筛选条件依赖项目列表（slug → id），故先取项目再取看板。
  const projects = await listPersonalProjects(user.id);
  const activeProject = projects.find(
    (project) => project.slug === requestedSlug,
  );

  const filter = {
    ...(activeProject ? { projectId: activeProject.id } : {}),
    ...statFilter,
  };
  // 卡片、统计与列表的窗口外已完成共用同一组筛选谓词（统计带数字与看板内容不叉）。
  const [board, stats, olderDone] = await Promise.all([
    getPersonalSpaceBoard(user.id, today, filter),
    getPersonalKanbanStats(user.id, today, filter),
    getOlderDonePersonalTasks(user.id, today, filter),
  ]);

  const allCards = [
    ...board.todo,
    ...board.inProgress,
    ...board.doneRecent,
    ...olderDone,
  ];
  const taskHrefs = Object.fromEntries(
    allCards.map((card) => [card.id, personalTaskHref(card.id)]),
  );
  // 列表视图行 = 三列卡片 + 窗口外已完成，默认排序由 sortTaskRows 统一口径。
  const rows = sortTaskRows(allCards);

  // 「N 个任务」= 当前筛选下的全部卡片（含窗口外已完成，doneTotal 已按筛选计算）。
  const total = board.todo.length + board.inProgress.length + board.doneTotal;
  const projectName = activeProject?.name ?? t("allProjects");

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <PageHeader
        title={tNav("tasks")}
        subtitle={t("personalSubtitle")}
        actions={
          <PersonalKanbanNewTaskButton
            projects={projects.map(({ id, name }) => ({ id, name }))}
            defaultProjectId={activeProject?.id}
          />
        }
      />

      <KanbanStatStrip
        stats={stats}
        today={today}
        active={{
          status: statFilter.status,
          overdue: statFilter.overdueOnly,
          dueSoon: statFilter.dueSoonOnly,
        }}
        basePath={moduleHref("personal", "tasks")}
        preserveParams={
          activeProject ? { project: activeProject.slug } : {}
        }
      />

      <SpaceKanbanFilterBar
        variant="personal"
        basePath={moduleHref("personal", "tasks")}
        statParams={{
          ...(statFilter.status ? { status: statFilter.status } : {}),
          ...(statFilter.overdueOnly ? { overdue: "1" } : {}),
          ...(statFilter.dueSoonOnly ? { dueSoon: "1" } : {}),
        }}
        caption={t("captionPersonal", { project: projectName, count: total })}
        todayCaption={tDate("todayCaption", {
          date: today,
          weekday: tDate(WEEKDAY_KEYS[weekdayIndex(today)]),
        })}
      />

      <div className="mt-5">
        <TasksViewTabs
          initialView={initialView}
          projects={projects}
          board={
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
          }
          list={
            <SpaceTaskTable
              variant="personal"
              rows={rows}
              today={today}
              taskHrefs={taskHrefs}
            />
          }
        />
      </div>
    </div>
  );
}
