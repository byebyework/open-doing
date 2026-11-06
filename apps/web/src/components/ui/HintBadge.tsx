"use client";

import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";
import { cn } from "@/lib/utils";

/** HintBadge 入参。 */
export interface HintBadgeProps {
  /** 触发器上的实时摘要（如「13 个未完成」）；可选。 */
  summary?: string;
  /** 弹层标题。 */
  title?: string;
  /** 弹层条目列表（纯文本要点）。 */
  items?: string[];
  /** 触发器的可访问名，由调用方翻译传入。 */
  ariaLabel: string;
  /** 富文本弹层内容（items 的替代）。 */
  children?: ReactNode;
  /** 触发器附加类名（布局微调用）。 */
  className?: string;
}

/**
 * 次级说明收束为 ⓘ 徽章：点击弹出 Popover 展示标题 + 条目/富文本。
 *
 * 按需求方「点击可以查看」而非悬停 tooltip。摘要常驻触发器（页面一瞥即可读），
 * 内容经 Portal 渲染（SSR 关闭态不落文档），因此 SSR 可见信息只有图标与 summary。
 * 本组件不含自有文案：所有字符串由调用方翻译后经 props 传入（ariaLabel 必填）。
 */
export function HintBadge({
  summary,
  title,
  items,
  ariaLabel,
  children,
  className,
}: HintBadgeProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-4)] px-1 py-0.5 text-[12px] text-[var(--ink-500)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--ink-900)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            className,
          )}
        >
          {/* currentColor 绘制，随触发器 hover 一起变深；尺寸对齐仓库小图标约定。 */}
          <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {summary ? <span className="whitespace-nowrap">{summary}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-label={title ?? ariaLabel}
        className="w-auto max-w-[320px] shadow-[var(--shadow-popover)]"
      >
        {title ? (
          <h3 className="m-0 text-[13px] leading-snug font-semibold text-[var(--ink-900)]">
            {title}
          </h3>
        ) : null}
        {items?.length ? (
          <ul className="m-0 list-disc space-y-1 pl-4 text-[12px] leading-[1.6] text-[var(--ink-500)] marker:text-[var(--ink-400)]">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {children ? (
          <div className="text-[12px] leading-[1.6] text-[var(--ink-500)]">{children}</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
