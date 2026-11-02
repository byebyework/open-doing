"use client";

/**
 * Vendored from shadcn/ui (new-york) @ 2026-11-02.
 * 适配:去掉 next-themes 依赖(项目 v1 仅亮色,主题固定 light);
 * 位置对齐原型 Task 8 演示(右下角)。
 */
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="bottom-right"
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
