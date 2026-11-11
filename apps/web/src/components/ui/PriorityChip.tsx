"use client";

import type { TaskPriority } from "@open-doing/types";
import { useTranslations } from "next-intl";

/**
 * 优先级展示样式（对照原型 `.pri` / `.pri-dot`）。
 *
 * 非 token 字面量 `#a66b00` / `#f0a01e` / `#c3c8cf` 与原型一致，
 * 属于记忆中「无对应 token 的既有例外」。
 */
const PRIORITY_STYLE: Record<
  TaskPriority,
  { labelKey: "priorityLow" | "priorityMedium" | "priorityHigh"; className: string; dotClassName: string }
> = {
  high: {
    labelKey: "priorityHigh",
    className: "text-[var(--status-overdue)]",
    dotClassName: "bg-[var(--status-overdue)]",
  },
  medium: {
    labelKey: "priorityMedium",
    className: "text-[#a66b00]",
    dotClassName: "bg-[#f0a01e]",
  },
  low: {
    labelKey: "priorityLow",
    className: "text-[var(--ink-400)]",
    dotClassName: "bg-[#c3c8cf]",
  },
};

/** 优先级 -> `status` 无关的档位文案 key（渲染处用 tPriority 翻译）。 */
export function priorityLabelKey(priority: TaskPriority) {
  return PRIORITY_STYLE[priority].labelKey;
}

/** PriorityChip 入参。 */
export interface PriorityChipProps {
  priority: TaskPriority;
}

/**
 * 优先级 chip：色点 + 档位文字（列表「优先级」列用）。
 *
 * 文案来自 `tasks` 命名空间（priorityLow / priorityMedium / priorityHigh）。
 */
export function PriorityChip({ priority }: PriorityChipProps) {
  const t = useTranslations("tasks");
  const style = PRIORITY_STYLE[priority];

  return (
    <span
      data-testid="priority-chip"
      data-priority={priority}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium ${style.className}`}
    >
      <i aria-hidden className={`inline-block size-[7px] rounded-full ${style.dotClassName}`} />
      {t(style.labelKey)}
    </span>
  );
}

/** PriorityDot 入参。 */
export interface PriorityDotProps {
  priority: TaskPriority;
}

/**
 * 优先级色点（看板卡片用）：仅色点，悬停 title 显示档位文字。
 */
export function PriorityDot({ priority }: PriorityDotProps) {
  const t = useTranslations("tasks");
  const style = PRIORITY_STYLE[priority];

  return (
    <i
      data-testid="priority-dot"
      data-priority={priority}
      title={t(style.labelKey)}
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${style.dotClassName}`}
    />
  );
}
