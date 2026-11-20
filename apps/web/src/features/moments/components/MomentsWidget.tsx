import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { CARD_SHELL } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import { moduleHref } from "@/lib/routes";
import { WEEKDAY_KEYS } from "@/lib/today";

import type { MomentView } from "../service";

/**
 * pill 底色：对齐原型 `.moment-pill.tone-*` 的彩底横条。
 * `tone-*` 保留为语义标记（与原型同名，便于测试/检索），实际颜色走 token 变量：
 * 周期紫、倒计时琥珀、正计时绿。
 */
const TONE_CLASS: Record<MomentView["mode"], string> = {
  periodic: "tone-periodic bg-[var(--primary-bg)]",
  countdown: "tone-down bg-[var(--warning-bg)]",
  count_up: "tone-up bg-[var(--success-bg)]",
};

/** 大数字色档：与 `tone-*` 一一对应的语义色文字档。 */
const NUMBER_TONE_CLASS: Record<MomentView["mode"], string> = {
  periodic: "text-[var(--moment-periodic-color)]",
  countdown: "text-[var(--moment-down-color)]",
  count_up: "text-[var(--moment-up-color)]",
};

/**
 * 个人 Dashboard「时刻 · 置顶速览」小组件（server 组件，只负责看）。
 *
 * 取数由页面并行完成：`moments` 已是按置顶 / 方向排好序的前 N 项，组件不重算
 * 日期，只做文案分支与色调渲染；每列 pill 都是指向模块页的 `Link`（无详情页）。
 * `today` 是 RSC 契约的展示上下文（天数相对哪一天的口径），当前不参与渲染——
 * 日期计算全部收敛在 service / 纯函数里，组件不做时间算术。
 */
export async function MomentsWidget({
  moments,
}: {
  moments: MomentView[];
  today: string;
}) {
  const t = await getTranslations("moments");
  const tDate = await getTranslations("date");
  const locale = await getLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  const href = moduleHref("personal", "moments");

  /** 周期 pill 的副行：每日 / 每周{weekday} / 每月 {day} 日 / 每年。 */
  const periodicDesc = (moment: MomentView): string => {
    switch (moment.cycle) {
      case "weekly":
        // 星期名复用 `date` ns 的 WEEKDAY_KEYS 系列，服务端格式化为消息参数。
        return t("card.badgeWeekly", {
          weekday: tDate(WEEKDAY_KEYS[moment.weekday ?? 0]),
        });
      case "monthly":
        return t("card.badgeMonthly", { day: moment.dayOfMonth ?? 1 });
      case "yearly":
        return t("card.badgeYearly");
      default:
        return t("card.badgeDaily");
    }
  };

  /** 副行：周期看循环规则，正计时看起点，倒计时看目标日（锚点日按原型展示完整 ISO）。 */
  const descFor = (moment: MomentView): string => {
    if (moment.mode === "periodic") return periodicDesc(moment);
    if (moment.mode === "count_up") {
      return t("card.subSince", { date: moment.anchorDate });
    }
    return t("card.subTarget", { date: moment.anchorDate });
  };

  return (
    <section className={`mt-4 min-w-0 ${CARD_SHELL}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 pb-2 pt-4 min-[861px]:px-5">
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[var(--purple-600)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l1.9 5.7L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
        </svg>
        <h2 className="text-[15px] font-bold text-[var(--ink-900)]">
          {t("widget.title")}
        </h2>
        <Link
          href={href}
          className="ml-auto inline-flex items-center gap-0.5 whitespace-nowrap text-[12.5px] font-semibold text-[var(--purple-600)] no-underline transition-colors hover:text-[var(--purple-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple-600)]"
        >
          {t("widget.manage")}
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {moments.length === 0 ? (
        <EmptyState
          title={t("widget.emptyTitle")}
          description={t("widget.emptyBody")}
          action={
            <Link
              href={href}
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-pill)] bg-[image:var(--brand-gradient)] px-4 text-[14px] font-semibold text-white no-underline shadow-[var(--shadow-btn)] transition-shadow hover:shadow-[var(--shadow-btn-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple-600)]"
            >
              {t("widget.emptyAction")}
            </Link>
          }
        />
      ) : (
        <ul
          role="list"
          className="mt-3 grid grid-cols-1 gap-3 px-4 pb-4 min-[861px]:grid-cols-3 min-[861px]:px-5"
        >
          {moments.map((moment) => {
            const prefix =
              moment.direction === "today"
                ? t("card.prefixToday")
                : moment.direction === "upcoming"
                  ? t("card.prefixCountdown")
                  : t("card.prefixElapsed");
            const rawCount = moment.direction === "today" ? 0 : moment.days;
            // v1 的 zh 预格式化 / en 原始数分支：en 目录的 unit 是 ICU 复数
            // 消息，参数必须是数字（传字符串会让复数选择退化为 NaN）；zh
            // 目录里数字只作普通占位，先按 locale 加千分位。大数字展示统一
            // 走 Intl.NumberFormat，保证两种语言的千分位一致。
            const countParam =
              locale === "zh" ? numberFormat.format(rawCount) : rawCount;

            return (
              <li key={moment.id} className="min-w-0">
                <Link
                  href={href}
                  className={`flex min-w-0 items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--purple-600)] ${TONE_CLASS[moment.mode]}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-bold text-[var(--ink-900)]">
                      {moment.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-500)]">
                      {descFor(moment)}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-baseline gap-1">
                    <span className="text-[11px] text-[var(--ink-500)]">
                      {prefix}
                    </span>
                    <span
                      className={`text-[26px] font-bold leading-none tabular-nums ${NUMBER_TONE_CLASS[moment.mode]}`}
                    >
                      {numberFormat.format(rawCount)}
                    </span>
                    <span className="text-[11px] text-[var(--ink-500)]">
                      {t("card.unit", { count: countParam })}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
