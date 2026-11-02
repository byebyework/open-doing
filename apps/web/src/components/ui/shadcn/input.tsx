/**
 * Vendored from shadcn/ui (new-york, Tailwind v4) @ 2026-11-02.
 * 适配:aria-invalid 态用 tokens.css 的 --error 色系;尺寸保留官方 h-9。
 */
import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-[var(--radius-8)] border bg-card px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]",
        "aria-invalid:border-[var(--error)] aria-invalid:ring-[var(--error)]/25 aria-invalid:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
