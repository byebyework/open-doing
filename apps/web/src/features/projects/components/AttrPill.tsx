"use client";

import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/shadcn/popover";

/**
 * 属性行 pill（Linear 式）：图标 + 标签 + 当前值，点击弹出轻量编辑层。
 * 从 ProjectForm 抽出共用（状态 pill / 表单属性行）。
 */
export interface AttrPillProps {
  testid: string;
  icon: React.ReactNode;
  label: string;
  value?: string;
  valueActive?: boolean;
  children: (close: () => void) => React.ReactNode;
  disabled?: boolean;
  /** 安静样式：无边框透明底（Linear 主列属性行口径）。 */
  quiet?: boolean;
}

export function AttrPill({
  testid,
  icon,
  label,
  value,
  valueActive,
  children,
  disabled,
  quiet = false,
}: AttrPillProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          disabled={disabled}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50 ${quiet ? "" : "border border-[var(--border)] bg-[var(--card)]"}`}
        >
          <span className="text-[var(--color-text-muted)]">{icon}</span>
          <span>{label}</span>
          {value ? (
            <span className={valueActive ? "font-medium text-[var(--color-primary)]" : "text-[var(--color-text-secondary)]"}>
              {value}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-[180px] p-2">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

