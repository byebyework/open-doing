import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import {
  getPersonalProjectBySlug,
  listPersonalProjects,
} from "@/features/personal/projects/service";
import { ProjectDetailLayout } from "@/features/projects/components/ProjectDetailLayout";
import { ProjectDetailTabs } from "@/features/projects/components/ProjectDetailTabs";
import { ProjectTimeline } from "@/features/projects/components/ProjectTimeline";
import { listProjectTimeline } from "@/features/projects/activities";
import { ProjectMilestonesPanel } from "@/features/projects/components/ProjectMilestonesPanel";
import { ProjectProgressPanel } from "@/features/projects/components/ProjectProgressPanel";
import { ProjectOverviewPanel } from "@/features/projects/components/ProjectOverviewPanel";
import { ProjectPropertiesPanel } from "@/features/projects/components/ProjectPropertiesPanel";
import { listPersonalProjectMilestonesWithProgress } from "@/features/personal/projects/service";
import { buildProjectProgressPercent } from "@/features/projects/service";
import { PersonalProjectPageActions } from "@/features/personal/tasks/components/TaskRowActions";
import { SpaceTaskTable } from "@/features/kanban/components/SpaceTaskTable";
import {
  getOlderDonePersonalTasks,
  getPersonalSpaceBoard,
} from "@/features/kanban/service";
import { sortTaskRows } from "@/features/kanban/sort-task-rows";
import { ProjectTasksList } from "@/features/projects/components/ProjectTasksList";
import { listTags } from "@/features/tags/service";
import { listPersonalProjectTasks } from "@/features/personal/tasks/service";
import { parseProjectTabFrom, parseProjectTaskFilters } from "@/lib/project-tab";
import { parseTaskPage, parseTaskPageSize } from "@/lib/task-origin";
import { personalTaskHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

interface PersonalProjectPageProps {
  /** Next 16：动态路由参数为 Promise，必须 await。 */
  params: Promise<{ projectSlug: string }>;
  /** `?tab=` / `?view=` / `?page=` / `?size=` / 统计筛选：tab 外壳与任务 tab 解析。 */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 个人项目页（P-3 → 详情 tabs）：概览 / 任务 / 动态。
 *
 * 任务 tab 为纯列表（`taskOrigin="project"` 回跳契约与任务模块一致），
 * 状态/标签/优先级筛选经 `?status=&priority=&tag=` 往返保持；
 * 动态 tab 为活动 + 评论时间线（`listProjectTimeline`）。
 * 服务端读取项目、项目任务（进度用）与全部个人项目，交互全部下沉到
 * `"use client"` 组件。非本人或不存在一律 404，不泄露存在性。
 */
export default async function PersonalProjectPage({
  params,
  searchParams,
}: PersonalProjectPageProps) {
  const { projectSlug } = await params;
  const sp = await searchParams;
  const tab = parseProjectTabFrom(sp);
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

  const user = await requireUser();
  const project = await getPersonalProjectBySlug(user.id, projectSlug);

  if (!project) notFound();

  const [tasks, projects, tagPool] = await Promise.all([
    listPersonalProjectTasks(user.id, project.id),
    listPersonalProjects(user.id),
    listTags({ ownerId: user.id }),
  ]);
  const milestoneProgress = await listPersonalProjectMilestonesWithProgress(user.id, project.id);
  const projectTagPool = tagPool.filter((tag) => tag.type === "project");
  const taskTagPool = tagPool.filter((tag) => tag.type === "task");

  const projectOptions = projects.map(({ id, name }) => ({ id, name }));
  const today = todayInShanghai();

  // ---- 动态 tab：活动 + 评论时间线（最近 100 条，createdAt 倒序）----
  let activityTabContent: ReactNode = null;
  if (tab === "activity") {
    const timelineItems = await listProjectTimeline(project.id);
    activityTabContent = (
      <ProjectTimeline
        projectId={project.id}
        items={timelineItems}
        currentUserId={user.id}
      />
    );
  }

  // ---- 任务 tab：纯列表 + 状态/标签/优先级筛选（筛选值经 URL 往返保持）----
  let tasksTabContent: ReactNode = null;
  if (tab === "tasks") {
    const initialPage = parseTaskPage(sp.page) ?? undefined;
    const initialPageSize = parseTaskPageSize(sp.size) ?? undefined;
    const listFilters = parseProjectTaskFilters(sp);

    const [board, olderDone] = await Promise.all([
      getPersonalSpaceBoard(user.id, today, { projectId: project.id }),
      getOlderDonePersonalTasks(user.id, today, { projectId: project.id }),
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
    const rows = sortTaskRows(allCards);

    tasksTabContent = (
      <ProjectTasksList
        initialFilters={listFilters}
        tagOptions={taskTagPool.map(({ id, name }) => ({ id, name }))}
      >
        <SpaceTaskTable
          variant="personal"
          rows={rows}
          today={today}
          taskHrefs={taskHrefs}
          taskOrigin="project"
          initialPage={initialPage}
          initialPageSize={initialPageSize}
        />
      </ProjectTasksList>
    );
  }

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

      {/* 概览页 PageHeader 不带标题（title 显式 undefined）：概览面板内的项目名是唯一 h1。 */}
      <PageHeader
        className="mt-2"
        title={undefined}
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
            projects={projectOptions}
          />
        }
      />

      <div className="mt-4">
        <ProjectDetailTabs active={tab} />
      </div>

      <ProjectDetailLayout
        mainKey={tab}
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
              progress={Object.fromEntries(
                milestoneProgress.map((item) => [
                  item.milestone.id,
                  { taskCount: item.taskCount, doneCount: item.doneCount, percent: item.percent },
                ]),
              )}
              canManage
            />
            <ProjectProgressPanel
              percent={buildProjectProgressPercent(tasks, today)}
            />
          </>
        }
      >
        <div className="mt-5">
          {tab === "tasks" ? (
            tasksTabContent
          ) : tab === "activity" ? (
            activityTabContent
          ) : (
            <ProjectOverviewPanel
              project={project}
              milestones={milestoneProgress}
              projectTagPool={projectTagPool}
              displayLead={null}
              canManage
              space={{ kind: "personal" }}
            />
          )}
        </div>
      </ProjectDetailLayout>
    </div>
  );
}
