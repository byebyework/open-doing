import type { Metadata } from "next";

import { requireUser } from "@/features/auth/session";
import { SpaceCalendar } from "@/features/calendar/components/SpaceCalendar";
import { getPersonalSpaceCalendar } from "@/features/calendar/service";
import { moduleHref, personalTaskHref, spaceDashboardHref } from "@/lib/routes";
import { todayInShanghai } from "@/lib/today";

export const metadata: Metadata = {
  title: "Calendar · Open Doing",
};

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
  const user = await requireUser();
  const today = todayInShanghai();
  const { month: monthParam } = await props.searchParams;
  const month =
    typeof monthParam === "string" && MONTH_PATTERN.test(monthParam)
      ? monthParam
      : today.slice(0, 7);

  const data = await getPersonalSpaceCalendar(user.id, month, today);

  const taskHrefs = Object.fromEntries(
    [...data.items, ...data.weekItems, ...data.monthUpcoming].map((card) => [
      card.id,
      personalTaskHref(card.id),
    ]),
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]">
      <header className="min-w-0">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[#0e1318]">
          Calendar
        </h1>
        <p className="mt-1.5 text-[14px] text-[#5f6368]">
          个人项目的任务日历:按截止日期看本月分布,右侧是本周清单与本月临期提醒。
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
        />
      </div>
    </div>
  );
}
