"use client";

import { PencilIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { CARD_SHELL } from "@/components/ui/card";
import { Button } from "@/components/ui/shadcn/button";

import type { ImportantDayView } from "../service";

/** DayCard 入参：卡片只做展示，动作交回给 DaysBoard。 */
export interface DayCardProps {
  day: ImportantDayView;
  /** 打开编辑弹窗。 */
  onEdit: () => void;
  /** 打开删除确认弹窗。 */
  onDelete: () => void;
  /** 置顶 / 取消置顶。 */
  onTogglePinned: () => void;
}

/**
 * 卡片墙中的单个「重要日子」卡片。
 *
 * 天数文案分支与 dashboard 小组件一致（今天 / 倒计时 / 正计时），
 * 日期行：公历展示锚点，农历展示换算后的最近发生日。徽标沿用
 * `DaysWidget` 的 pill 视觉，操作按钮均为 icon + aria-label。
 */
export function DayCard({
  day,
  onEdit,
  onDelete,
  onTogglePinned,
}: DayCardProps) {
  const t = useTranslations("days");
  const locale = useLocale();
  const numberFormat = new Intl.NumberFormat(locale);

  // zh 模板是普通占位（加千分位）；en 的 ICU plural 要求 `#` 里是数字，
  // 传成千分位字符串会让复数选择退化为 NaN（同样见于 DaysWidget）。
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

  const dateLine = day.isLunar ? day.occurrenceDate : day.anchorDate;

  return (
    <article
      data-testid={`day-card-${day.id}`}
      className={`flex min-w-0 flex-col gap-3 p-4 ${CARD_SHELL}`}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[14px] font-semibold text-[var(--ink-900)]">
          {day.title}
        </h2>
        <p
          className={`mt-2 text-[22px] font-bold leading-tight tabular-nums ${labelClass}`}
        >
          {label}
        </p>
        {dateLine ? (
          <p className="mt-1 text-[12.5px] text-[var(--ink-500)] tabular-nums">
            {dateLine}
          </p>
        ) : null}

        {day.repeat === "yearly" || day.isLunar ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {day.repeat === "yearly" ? (
              <span className="rounded-full bg-[var(--surface-cool)] px-2 py-0.5 text-[11px] font-medium text-[var(--purple-700)]">
                {t("card.everyYear")}
              </span>
            ) : null}
            {day.isLunar ? (
              <span className="rounded-full bg-[var(--surface-cool)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-500)]">
                {t("card.lunarBadge")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-1 border-t border-[var(--border-default)] pt-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          data-testid={`day-pin-${day.id}`}
          aria-label={
            day.pinned
              ? t("card.unpinnedAria", { title: day.title })
              : t("card.pinnedAria", { title: day.title })
          }
          aria-pressed={day.pinned}
          onClick={onTogglePinned}
        >
          {day.pinned ? (
            <PinOffIcon aria-hidden="true" />
          ) : (
            <PinIcon aria-hidden="true" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          data-testid={`day-edit-${day.id}`}
          aria-label={t("card.editAria", { title: day.title })}
          onClick={onEdit}
        >
          <PencilIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-8 text-[var(--ink-500)] hover:text-[var(--error)]"
          data-testid={`day-delete-${day.id}`}
          aria-label={t("card.deleteAria", { title: day.title })}
          onClick={onDelete}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
