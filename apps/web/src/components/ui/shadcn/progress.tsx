"use client";

/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 适配:增加 color prop(mapping to tokens.css 语义色,默认 --primary),
 * 对齐原型 `.progress.is-*` 变体。
 */
import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  color = "var(--primary)",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /** 进度条填充色;传 tokens.css 语义色变量(如 var(--error))。 */
  color?: string;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-muted relative h-2 w-full overflow-hidden rounded-full",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 rounded-full transition-all"
        style={{ background: color, transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
