
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { averageProjectProgress } from "@open-doing/types";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { NewPersonalProjectButton } from "@/features/personal/projects/components/NewPersonalProjectButton";
import { getPersonalProjectListWithStats } from "@/features/personal/projects/service";
import {
  ProjectListTable,
  type ProjectListRow,
} from "@/features/projects/components/ProjectListTable";
import { listTags, tagsByProjectId } from "@/features/tags/service";
import { personalProjectHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("projectsTitle") };
}

/**
 * 个人空间项目列表（表格模式，与团队列表同构）。
 *
 * 数据只按当前用户过滤（service 内保证）；新建入口为列表页弹窗
 * （`NewPersonalProjectButton`）。状态与进度百分数由 RSC 侧推导组装，
 * 筛选/搜索在客户端进行。
 */
export default async function PersonalProjectsPage() {
  const t = await getTranslations("projects");
  const user = await requireUser();

  const today = todayInShanghai();
  const [list, projectTagPool] = await Promise.all([
    getPersonalProjectListWithStats(user.id, today),
    listTags({ ownerId: user.id }).then((tags) =>
      tags.filter((tag) => tag.type === "project"),
    ),
  ]);
  const projectTagsMap = await tagsByProjectId(list.map((item) => item.project.id));

  const rows: ProjectListRow[] = list.map((item) => ({
    id: item.project.id,
    name: item.project.name,
    summary: item.project.summary,
    description: item.project.description,
    href: personalProjectHref(item.project.slug),
    priority: item.project.priority,
    tags: projectTagsMap.get(item.project.id) ?? [],
    status: item.project.status,
    lead: null,
    members: [],
    progressPercent: Math.round(item.stats.progress * 100),
    milestoneCount: item.milestoneCount,
    startDate: item.project.startDate,
    endDate: item.project.endDate,
    taskCount: item.stats.taskCount,
    doneCount: item.stats.doneCount,
    overdueCount: item.stats.overdueCount,
  }));

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-testid="projects-list-page">
      <PageHeader
        title={
          <>
            {t("listTitle")}{" "}
            <span className="inline-flex items-center rounded-full bg-[var(--color-primary-bg)] px-2.5 py-0.5 align-middle text-[12.5px] font-medium text-[var(--color-primary)]">
              {t("headerBadge", {
                count: rows.length,
                percent: Math.round(
                  averageProjectProgress(
                    list.map((item) => item.stats.progress),
                  ) * 100,
                ),
              })}
            </span>
          </>
        }
        subtitle={t("listSubtitlePersonal")}
        actions={<NewPersonalProjectButton projectTagPool={projectTagPool} />}
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t("listEmptyTitle")} description={t("listEmptyHint")} />
        </div>
      ) : (
        <div className="mt-6">
          <ProjectListTable
            rows={rows}
            space={{ kind: "personal" }}
            canManage
          />
        </div>
      )}
    </div>
  );
}
