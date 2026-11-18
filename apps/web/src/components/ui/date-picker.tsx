"use client";

/**
 * 日期选择复合组件：原生 `type="date"` input + shadcn Popover 日历。
 *
 * 设计意图（混合式）：
 * - input 保留原生键盘输入（可手打 YYYY-MM-DD），非日历选择时也走 onChange；
 * - Chromium 原生日历选择器用 `[&::-webkit-calendar-picker-indicator]:hidden`
 *   压掉，日历统一由 Popover 内的 Calendar 提供；
 * - 只用 PopoverAnchor 包 input，不用 PopoverTrigger：Radix 的 Trigger 会把
 *   input 渲染成 button 语义并抢焦点。**点击才弹日历**（聚焦不弹）。
 * - 受控打开：选择日历日后写回 `onChange(YYYY-MM-DD)` 并关闭。
 *
 * 日期零时区运算：Date ↔ 字符串只走本地 Y/M/D 拆装（`new Date(y, m-1, d)`
 * ↔ `getFullYear/getMonth/getDate`），不经 `Date.parse("YYYY-MM-DD")`
 * （后者按 UTC 解析，跨时区会串日）。
 *
 * 日历 locale 跟随 next-intl `useLocale()`：en → date-fns enUS，其余 → zhCN；
 * RDP 的上一月/下一月 aria label 走 `date.pickerPreviousMonth` /
 * `date.pickerNextMonth` 消息键。样式只走 token CSS 变量（继承 shadcn Input
 * 与 vendored Calendar 的默认映射）。
 */
import { enUS, zhCN } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Calendar } from "@/components/ui/shadcn/calendar";
import { Input } from "@/components/ui/shadcn/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/shadcn/popover";
import { cn } from "@/lib/utils";

/** DatePicker 入参（受控值 + 原生 input 透传属性）。 */
export interface DatePickerProps {
  id?: string;
  /** 受控值：YYYY-MM-DD 或空串（未选）。 */
  value: string;
  /** 日历选日 / 用户在原生 input 手输时回调，参数为 YYYY-MM-DD 或空串。 */
  onChange: (value: string) => void;
  disabled?: boolean;
  /** → aria-invalid。 */
  invalid?: boolean;
  /** → aria-describedby。 */
  describedby?: string;
  /** → data-testid。 */
  testid?: string;
  /** 透传到 input（保留现有宽度类）。 */
  className?: string;
}

/** 规范形态的 ISO 日期串（原生 date input 的取值格式）。 */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 两位补零。 */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * "YYYY-MM-DD" → 本地零时 Date；空串 / 非法 / 不存在的日期返回 undefined。
 *
 * 先按正则拆出 Y/M/D 再本地构造；构造后回读三个分量必须与输入一致，
 * 借 Date 的月末回卷特性识别 2026-02-30 这类不存在的日期。
 */
export function parseISODate(value: string): Date | undefined {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

/** 本地 Date → "YYYY-MM-DD"（月日两位补零）。 */
export function formatISODate(day: Date): string {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
}

/**
 * 混合式日期选择器。input 点击弹出 Popover 日历；选择后写回并关闭。
 */
export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedby,
  testid,
  className,
}: DatePickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const t = useTranslations("date");
  const dateLocale = locale === "en" ? enUS : zhCN;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedby}
          data-testid={testid}
          className={cn(
            "[&::-webkit-calendar-picker-indicator]:hidden",
            className,
          )}
        />
      </PopoverAnchor>
      <PopoverContent>
        <Calendar
          mode="single"
          required
          selected={parseISODate(value)}
          defaultMonth={parseISODate(value)}
          onSelect={(day) => {
            if (!day) return;
            onChange(formatISODate(day));
            setOpen(false);
          }}
          locale={dateLocale}
          labels={{
            labelPrevious: () => t("pickerPreviousMonth"),
            labelNext: () => t("pickerNextMonth"),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
