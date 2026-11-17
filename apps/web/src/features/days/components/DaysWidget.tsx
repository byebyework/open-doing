import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { CARD_SHELL } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";

import type { ImportantDayView } from "../service";

/** 徽标：每年重复 / 农历（农历日子每年自动滚动，两者同时出现）。 */
function DayBadges({
  repeat,
  isLunar,
  everyYear,
  lunar,
}: {
  repeat: ImportantDayView["repeat"];
  isLunar: boolean;
  everyYear: string;
  lunar: string;
}) {
  if (repeat !== "yearly" && !isLunar) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {repeat === "yearly" ? (
        <span className="rounded-full bg-[var(--surface-cool)] px-2 py-0.5 text-[11px] font-medium text-[var(--purple-700)]">
          {everyYear}
        </span>
      ) : null}
      {isLunar ? (
        <span className="rounded-full bg-[var(--surface-cool)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-500)]">
          {lunar}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 个人 Dashboard 底部「我的日子」小组件（server 组件，只负责看）。
 *
 * 取数由页面并行完成：`days` 已是按置顶 / 方向排好序的前 N 项，
 * 组件不重算日期，只做文案分支与徽标渲染。`today` 是展示上下文
 * （天数相对哪一天的口径），后续交互/详情跳转可能用到，当前不参与渲染。
 */
export async function DaysWidget({
  days,
}: {
  days: ImportantDayView[];
  today: string;
}) {
  const t = await getTranslations("days");
  const locale = await getLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  // v1 遗留：`SpaceModule` 已更名 moments，本组件在 Task 7 随 days 域一起删除；
  // 为保持中间态构建全绿，这里临时用字面路由，不再经 moduleHref 的类型收窄。
  const href = "/space/personal/days";

  return (
    <section className={`mt-5 min-w-0 ${CARD_SHELL}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-2 pt-4 min-[861px]:px-5">
        <h2 className="text-[15px] font-bold text-[var(--ink-900)]">
          {t("widget.title")}
        </h2>
        <Link
          href={href}
          className="ml-auto whitespace-nowrap text-[12.5px] font-medium text-[var(--purple-600)] no-underline hover:underline"
        >
          {t("widget.viewAll")}
        </Link>
      </div>

      {days.length === 0 ? (
        <EmptyState
          title={t("widget.emptyTitle")}
          description={t("widget.emptyBody")}
          action={
            <Link
              href={href}
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-8)] bg-[image:var(--brand-gradient)] px-4 text-[14px] font-semibold text-white no-underline shadow-[var(--shadow-btn)] transition-shadow hover:shadow-[var(--shadow-btn-hover)]"
            >
              {t("widget.emptyAction")}
            </Link>
          }
        />
      ) : (
        <ul className="px-4 pb-1 min-[861px]:px-5">
          {days.map((day) => {
            // zh 模板是普通占位，先按 locale 加千分位；en 的 ICU plural 用
            // `#` 输出，占位必须是数字（传字符串会让复数选择退化为 NaN）。
            const count =
              locale === "zh" ? numberFormat.format(day.days) : day.days;
            const label =
              day.days === 0
                ? t("card.isToday")
                : day.direction === "upcoming"
                  ? t("card.countdown", { count })
                  : t("card.elapsed", { count });
            const labelClass =
              day.days === 0
                ? "text-[var(--purple-600)]"
                : day.direction === "upcoming"
                  ? "text-[var(--ink-900)]"
                  : "text-[var(--ink-500)]";

            return (
              <li
                key={day.id}
                className="flex min-w-0 items-center gap-3 border-t border-[var(--border-default)] py-3 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-[var(--ink-900)]">
                    {day.title}
                  </div>
                  <DayBadges
                    repeat={day.repeat}
                    isLunar={day.isLunar}
                    everyYear={t("card.everyYear")}
                    lunar={t("card.lunarBadge")}
                  />
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap text-[14px] font-semibold tabular-nums ${labelClass}`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
