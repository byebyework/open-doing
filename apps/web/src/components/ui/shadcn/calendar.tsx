"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-18.
 * 适配：
 * - 基于 react-day-picker v10 的 DayPicker：v10 中 Day 渲染为 `<td>`、DayButton
 *   为 `<button>`，本组件只做 classNames 映射，不自定义 Day 渲染；与
 *   SpaceCalendar 的自绘 Day 用法（任务 chip / 自绘标题行）无关，互不影响。
 * - 配色只走 token CSS 变量：选中 --purple-600 + 白字、今天 --purple-08、
 *   禁用 --ink-400 半透明（无字面色值）。
 * - 默认 month caption 用 Intl 按 locale 的 year/month 片段重排并在字面分隔符
 *   两侧留空格（zh「2026 年 11 月」、en「November 2026」），避免 date-fns 的
 *   「十一月 2026」式年份后置；消费方传入 formatters 时以传入值为准。
 * - 消费方传入的 className / classNames 与默认映射合并（逐键 cn 拼接），
 *   不会整体覆盖默认样式。
 */
import {
  DayPicker,
  formatCaption as formatCaptionDefault,
  type ClassNames,
  type DayPickerProps,
  type Formatters,
} from "react-day-picker";

import { cn } from "@/lib/utils";

/** 各元素的默认 Tailwind 映射（网格布局 / hover / 选中 / 禁用态）。 */
const defaultClassNames: Partial<ClassNames> = {
  root: "w-fit p-3",
  // 单月固定纵排：不要 md:flex-row / gap-4——nav 的按钮全是 absolute，
  // nav 自身在流内是零宽盒子，在行向 flex 里会作为一个 flex item 把
  // month 顶出一个 gap-4 的左偏移（2026-11-18 取证：网格左 55 / 右 19）。
  months: "relative flex flex-col",
  month: "flex w-full flex-col gap-4",
  // display:contents：nav 不产生盒，prev/next（absolute）直接锚定 months。
  nav: "contents",
  button_previous:
    "absolute left-0 top-0 inline-flex size-8 items-center justify-center rounded-lg text-[var(--ink-700)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] disabled:pointer-events-none disabled:opacity-40",
  button_next:
    "absolute right-0 top-0 inline-flex size-8 items-center justify-center rounded-lg text-[var(--ink-700)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] disabled:pointer-events-none disabled:opacity-40",
  chevron: "size-4 fill-[var(--ink-700)]",
  month_caption: "flex h-8 w-full items-center justify-center px-8",
  caption_label: "select-none text-sm font-medium text-[var(--ink-900)]",
  month_grid: "w-full border-collapse",
  weekday:
    "pb-1 text-center text-[0.8rem] font-normal text-[var(--ink-400)] select-none",
  // v10 的选中 / 今天 / 禁用等修饰类都落在日格 `<td>` 上（Day 组件），
  // 悬停背景因此挂在内部的 DayButton 上。
  day: "relative rounded-full p-0 text-center text-sm focus-within:relative focus-within:z-20",
  day_button:
    "size-8 rounded-full p-0 font-normal transition-colors hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-30)]",
  selected:
    "bg-[var(--purple-600)] text-white [&>button:hover]:bg-[var(--purple-600)] [&>button:hover]:text-white",
  today: "font-semibold text-[var(--purple-600)]",
  outside: "text-[var(--ink-400)] aria-selected:text-white",
  disabled: "text-[var(--ink-400)] opacity-40",
  hidden: "invisible",
  dropdowns: "flex items-center gap-2",
  dropdown: "rounded-lg bg-transparent text-sm",
  dropdown_root: "relative",
  footer: "pt-2 text-sm text-[var(--ink-400)]",
};

/** month caption：按 locale 的年/月片段组装，字面分隔符两侧留空格。 */
const formatMonthCaption: Formatters["formatCaption"] = (
  month,
  options,
  dateLib,
) => {
  const localeCode = options?.locale?.code;

  if (!localeCode) return formatCaptionDefault(month, options, dateLib);

  try {
    const parts = new Intl.DateTimeFormat(localeCode, {
      month: "long",
      year: "numeric",
      timeZone: options?.timeZone,
      numberingSystem: options?.numerals,
    }).formatToParts(month);

    return parts
      .map((part) =>
        part.type === "literal" ? ` ${part.value.trim()} ` : part.value,
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return formatCaptionDefault(month, options, dateLib);
  }
};

/** 逐键合并默认映射与消费方覆盖（覆盖值追加而非整体替换）。 */
function mergeClassNames(
  defaults: Partial<ClassNames>,
  overrides?: Partial<ClassNames>,
): Partial<ClassNames> {
  if (!overrides) return defaults;

  return {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [
        key,
        cn(defaults[key as keyof ClassNames], value),
      ]),
    ),
  };
}

/**
 * Calendar（react-day-picker v10）。接受 DayPicker 全部 props（locale、
 * selected、onSelect、defaultMonth、classNames、formatters 等）；
 * 仅补齐本仓库的 token 样式映射与 caption 格式。
 */
function Calendar({
  className,
  classNames,
  formatters,
  showOutsideDays = true,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={className}
      classNames={mergeClassNames(defaultClassNames, classNames)}
      formatters={{ formatCaption: formatMonthCaption, ...formatters }}
      {...props}
    />
  );
}

export { Calendar };
