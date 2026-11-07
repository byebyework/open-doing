import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireUser } from "@/features/auth/session";
import { SpaceCalendar } from "@/features/calendar/components/SpaceCalendar";
import { getPersonalSpaceCalendar } from "@/features/calendar/service";
import { listPersonalProjects } from "@/features/personal/projects/service";
import { moduleHref, personalTaskHref, spaceDashboardHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");

  return { title: t("calendarTitle") };
}

/** `?month=YYYY-MM` 合法格式（月份段 01–12）；其余一律回退当前月。 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 个人空间 Calendar（v1.1 M4）。
 *
 * RSC 取数：`?month=YYYY-MM` 决定月网格窗口；缺失 / 非法 / 数组参数静默回退
 * 当前月（不 500、不报错）。翻月交互下沉到 client 组件，写回 URL。
 */
export default async function PersonalCalendarPage(
  props: PageProps<"/space/personal/calendar">,
) {
  const t = await getTranslations("calendar");
  const tNav = await getTranslations("nav");
  const user = await requireUser();
  const today = todayInShanghai();
  const { month: monthParam } = await props.searchParams;
  const month =
    typeof monthParam === "string" && MONTH_PATTERN.test(monthParam)
      ? monthParam
      : today.slice(0, 7);

  const data = await getPersonalSpaceCalendar(user.id, month, today);
  // 格子「+」新建任务入口的项目选项（与 Kanban 页头新建弹窗同源）。
  const projects = await listPersonalProjects(user.id);

  const taskHrefs = Object.fromEntries(
    [...data.items, ...data.weekItems, ...data.monthUpcoming].map((card) => [
      card.id,
      personalTaskHref(card.id),
    ]),
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <header className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]">
          {tNav("calendar")}
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--ink-500)]">
          {t("personalSubtitle")}
        </p>
      </header>

      <div className="mt-5">
        <SpaceCalendar
          variant="personal"
          month={month}
          today={today}
          data={data}
          taskHrefs={taskHrefs}
          basePath={moduleHref("personal", "calendar")}
          noDueHref={spaceDashboardHref("personal")}
          createTask={{
            projects: projects.map(({ id, name }) => ({ id, name })),
          }}
        />
      </div>
    </div>
  );
}
