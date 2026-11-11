import type { ProjectHealthKind } from "@open-doing/types";
import { getProjectHealthKind } from "@open-doing/types";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/features/auth/session";
import { NewPersonalProjectButton } from "@/features/personal/projects/components/NewPersonalProjectButton";
import { getPersonalProjectListWithStats } from "@/features/personal/projects/service";
import { ProjectStatsCard } from "@/features/projects/components/ProjectStatsCard";
import { personalProjectHref } from "@/lib/routes";
import { WEEKDAY_KEYS, todayInShanghai, weekdayIndex } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("projectsTitle") };
}

/**
 * 个人空间项目列表（v1.2「项目」模块）。
 *
 * 数据只按当前用户过滤（service 内保证）；新建入口复用「我的任务」页的
 * `NewPersonalProjectButton`（弹窗成功后 router.refresh 即时刷新列表）。
 * 健康徽标口径与团队列表相同（个人任务同样可逾期/临期）。
 */
export default async function PersonalProjectsPage() {
  const t = await getTranslations("projects");
  const tDate = await getTranslations("date");
  const user = await requireUser();

  const today = todayInShanghai();
  const list = await getPersonalProjectListWithStats(user.id, today);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-testid="projects-list-page">
      <PageHeader
        title={t("listTitle")}
        subtitle={t("listSubtitlePersonal")}
        actions={<NewPersonalProjectButton />}
      />

      <div className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted-foreground)]">
        <span>{t("summaryPersonal", { count: list.length })}</span>
        <span>· {t("sortNote")}</span>
        <span className="ml-auto">
          {tDate("todayCaption", {
            date: today,
            weekday: tDate(WEEKDAY_KEYS[weekdayIndex(today)]),
          })}
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState title={t("listEmptyTitle")} description={t("listEmptyHint")} />
      ) : (
        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {list.map((item) => (
            <ProjectStatsCard
              key={item.project.id}
              name={item.project.name}
              description={item.project.description}
              href={personalProjectHref(item.project.slug)}
              stats={item.stats}
              health={getProjectHealthKind(item.stats) as ProjectHealthKind}
            />
          ))}
        </div>
      )}
    </div>
  );
}
