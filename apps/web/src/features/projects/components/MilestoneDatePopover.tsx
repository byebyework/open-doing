"use client";

import type { ReactNode } from "react";
import { CalendarPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Calendar } from "@/components/ui/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/shadcn/popover";

/** `YYYY-MM-DD` -> 本地零时 Date（Calendar 受控值）。 */
function parseISODate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Date -> `YYYY-MM-DD`。 */
function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface MilestoneDatePopoverProps {
  /** `YYYY-MM-DD` 或空串（未设置）。 */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 触发按钮 testid。 */
  testid?: string;
  /** 触发按钮附加内容（如日期文本）。 */
  children?: ReactNode;
}

/**
 * 里程碑行内日期图标按钮（对照 Linear 行尾日历图标）：Popover + Calendar
 * 快速设/改时间，不必进完整编辑态。
 */
export function MilestoneDatePopover({
  value,
  onChange,
  disabled,
  testid = "milestone-date-button",
  children,
}: MilestoneDatePopoverProps) {
  const t = useTranslations("projects");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          disabled={disabled}
          aria-label={t("milestoneDueDateLabel")}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[12.5px] tabular-nums text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          <CalendarPlusIcon
            className={`size-3.5 ${value ? "text-[var(--color-primary)]" : ""}`}
            aria-hidden="true"
          />
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={parseISODate(value)}
          onSelect={(day) => {
            onChange(day ? toISODate(day) : "");
            setOpen(false);
          }}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
