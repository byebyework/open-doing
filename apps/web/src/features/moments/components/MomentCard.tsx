"use client";

import { PencilIcon, PinIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { CARD_SHELL } from "@/components/ui/card";
import { Button } from "@/components/ui/shadcn/button";
import { cn } from "@/lib/utils";
import { WEEKDAY_KEYS } from "@/lib/today";

import type { MomentView } from "../service";

/** MomentCard 入参：卡片只做展示，动作交回给 MomentsBoard。 */
export interface MomentCardProps {
  moment: MomentView;
  /** 打开编辑弹窗。 */
  onEdit: () => void;
  /** 打开删除确认弹窗。 */
  onDelete: () => void;
  /** 置顶 / 取消置顶。 */
  onTogglePinned: () => void;
}

/** 大数字色档：周期紫 / 倒计时琥珀 / 正计时绿（对齐原型 is-periodic / is-down / is-up）。 */
const NUMBER_TONE_CLASS: Record<MomentView["mode"], string> = {
  periodic: "text-[var(--moment-periodic-color)]",
  countdown: "text-[var(--moment-down-color)]",
  count_up: "text-[var(--moment-up-color)]",
};

/** 模式徽标底色：与数字色档同一语义（紫 / 琥珀 / 绿）。 */
const BADGE_TONE_CLASS: Record<MomentView["mode"], string> = {
  periodic: "bg-[var(--primary-bg)] text-[var(--purple-600)]",
  countdown: "bg-[var(--warning-bg)] text-[var(--moment-down-color)]",
  count_up: "bg-[var(--success-bg)] text-[var(--success-500)]",
};

/**
 * 卡片墙中的单个「时刻」卡片（原型分节 A）。
 *
 * 头部：名称 + 置顶徽标 + 模式徽标；大数字行按方向取前缀（今天 / 还有 / 已经），
 * 数字色按模式（`tabular-nums`）；副行按模式展示锚点日或下一次发生日。
 * 正计时 / 倒计时的锚点日按原型展示完整 ISO `YYYY-MM-DD`（保留年份）；
 * 周期副行的下一次发生日用 `Intl.DateTimeFormat` 的「月长名 + 日」格式
 * （UTC 解析，避免时区回退）。
 * 操作行：图钉（描边=置顶、实心=取消置顶，`aria-pressed`）、编辑、删除；
 * `aria-label` 携带名称，满足图标按钮的可访问性要求。
 */
export function MomentCard({
  moment,
  onEdit,
  onDelete,
  onTogglePinned,
}: MomentCardProps) {
  const t = useTranslations("moments");
  const tDate = useTranslations("date");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    // 锚点日是日历日（非时间戳），固定按 UTC 解析/显示，避免本地时区回退一天。
    timeZone: "UTC",
  });

  /** 公历 `YYYY-MM-DD` → `12月1日` / `December 1`（周期副行的下一次发生日）。 */
  const formatDate = (date: string) =>
    dateFormat.format(new Date(`${date}T00:00:00Z`));

  const weekdayName = tDate(WEEKDAY_KEYS[moment.weekday ?? 0]);

  /** 模式徽标：正计时 / 倒计时 / 每天 · 循环 / 每周X · 循环 / …。 */
  const badgeText = (() => {
    if (moment.mode === "count_up") return t("card.badgeUp");
    if (moment.mode === "countdown") return t("card.badgeDown");

    switch (moment.cycle) {
      case "weekly":
        return t("card.badgeWeekly", { weekday: weekdayName });
      case "monthly":
        return t("card.badgeMonthly", { day: moment.dayOfMonth ?? 1 });
      case "yearly":
        return t("card.badgeYearly");
      default:
        return t("card.badgeDaily");
    }
  })();

  /** 副行：正计时看起点，倒计时看目标日，周期看循环规则 + 下一次发生日。 */
  const subText = (() => {
    // 原型对正计时 / 倒计时展示完整 ISO 日期「2025-09-15 至今」「目标 2031-06-30」。
    if (moment.mode === "count_up") {
      return t("card.subSince", { date: moment.anchorDate });
    }
    if (moment.mode === "countdown") {
      return t("card.subTarget", { date: moment.anchorDate });
    }

    switch (moment.cycle) {
      case "weekly":
        return t("card.subWeekly", {
          weekday: weekdayName,
          date: formatDate(moment.occurrenceDate),
        });
      case "monthly":
        return t("card.subMonthly", {
          day: moment.dayOfMonth ?? 1,
          date: formatDate(moment.occurrenceDate),
        });
      case "yearly":
        return t("card.subYearly", { date: formatDate(moment.occurrenceDate) });
      default:
        return t("card.subDaily");
    }
  })();

  const prefix =
    moment.direction === "today"
      ? t("card.prefixToday")
      : moment.direction === "upcoming"
        ? t("card.prefixCountdown")
        : t("card.prefixElapsed");

  // zh 的 unit 是普通占位（先按 locale 加千分位）；en 是 ICU 复数消息，
  // 参数必须是数字（传千分位字符串会让复数选择退化为 NaN）。
  const countParam = locale === "zh" ? numberFormat.format(moment.days) : moment.days;

  return (
    <article
      data-testid={`moment-card-${moment.id}`}
      className={cn(
        "flex min-w-0 flex-col gap-2 p-5 transition-shadow hover:shadow-[var(--shadow-card-hover)]",
        CARD_SHELL,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-[14px] font-bold text-[var(--ink-900)]">
          {moment.title}
        </h2>
        {moment.pinned ? (
          <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-[var(--purple-14)] px-2 py-0.5 text-[11px] font-semibold text-[var(--purple-700)]">
            {t("card.badgePinned")}
          </span>
        ) : null}
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
            moment.pinned ? "" : "ml-auto",
            BADGE_TONE_CLASS[moment.mode],
          )}
        >
          {badgeText}
        </span>
      </div>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[13px] text-[var(--ink-500)]">{prefix}</span>
        <span
          className={cn(
            "text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums",
            NUMBER_TONE_CLASS[moment.mode],
          )}
        >
          {numberFormat.format(moment.days)}
        </span>
        <span className="text-[13px] text-[var(--ink-500)]">
          {t("card.unit", { count: countParam })}
        </span>
      </div>

      <p className="text-[12px] text-[var(--ink-400)]">{subText}</p>

      <div className="mt-2 flex items-center gap-1 border-t border-[var(--border-default)] pt-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-8",
            moment.pinned
              ? "text-[var(--purple-700)]"
              : "text-[var(--ink-500)]",
          )}
          data-testid={`moment-pin-${moment.id}`}
          aria-label={moment.pinned ? t("card.actionUnpin") : t("card.actionPin")}
          aria-pressed={moment.pinned}
          onClick={onTogglePinned}
        >
          <PinIcon
            aria-hidden="true"
            className={moment.pinned ? "fill-current" : undefined}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-[var(--ink-500)]"
          data-testid={`moment-edit-${moment.id}`}
          aria-label={t("card.actionEdit", { title: moment.title })}
          onClick={onEdit}
        >
          <PencilIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-[var(--ink-500)] hover:text-[var(--error)]"
          data-testid={`moment-delete-${moment.id}`}
          aria-label={t("card.actionDelete", { title: moment.title })}
          onClick={onDelete}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
