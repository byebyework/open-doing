/**
 * 共享页头：对齐原型 .page-header / .page-actions —— 左列 30px H1（--text-h1 规格）
 * + 13.5px 副标题（.sub，--muted-foreground），右侧 actions（gap-2，窄屏换行）。
 * 全部页面统一用这一规格，不再各页内联复制页头 JSX。
 */
import * as React from "react";

import { cn } from "@/lib/utils";

function PageHeader({
  title,
  subtitle,
  actions,
  titleTestId,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** e2e 需要锚定标题时使用（如 create-team-heading）。 */
  titleTestId?: string;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 min-[861px]:flex-row min-[861px]:items-start min-[861px]:justify-between min-[861px]:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h1
          data-testid={titleTestId}
          className="break-words text-[30px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--ink-900)]"
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 text-[13.5px] text-[var(--muted-foreground)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export { PageHeader };
