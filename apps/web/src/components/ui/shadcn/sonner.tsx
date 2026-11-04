"use client";

/**
 * Vendored from shadcn/ui (new-york) @ 2026-11-02.
 * 适配:去掉 next-themes 依赖(项目 v1 仅亮色,主题固定 light);
 * 位置对齐原型 Task 8 演示(右下角);
 * 阴影对齐原型 .toast 的 shadow-popover(sonner 默认阴影偏黑偏浅,走查实测偏差);
 * 成功/错误图标对齐原型 .toast-icon(18px 圆底 --success/--error,白色 ✓/× 字形)。
 */
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="bottom-right"
      icons={{
        success: (
          <span
            aria-hidden="true"
            className="flex size-[18px] flex-none items-center justify-center rounded-full bg-[var(--success)] text-[11px] leading-none text-white"
          >
            ✓
          </span>
        ),
        error: (
          <span
            aria-hidden="true"
            className="flex size-[18px] flex-none items-center justify-center rounded-full bg-[var(--error)] text-[11px] leading-none text-white"
          >
            ×
          </span>
        ),
      }}
      toastOptions={{
        style: {
          boxShadow: "var(--shadow-popover)",
        },
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
