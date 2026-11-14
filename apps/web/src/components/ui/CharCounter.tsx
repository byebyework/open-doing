import { cn } from "@/lib/utils";

/**
 * 字数计数提示（"已输入 / 上限"，如 50 / 200）。
 *
 * 纯展示：放在有限长的输入框下方右对齐；超过上限时整条转为错误色，
 * 提醒输入已被表单校验拒绝（截断/报错语义由输入框自身规则决定）。
 */
export function CharCounter({
  value,
  max,
  className,
}: {
  value: string;
  max: number;
  className?: string;
}) {
  const over = value.length > max;

  return (
    <div
      data-over={over ? "true" : undefined}
      className={cn(
        "mt-1 text-right text-[12px] tabular-nums text-[var(--ink-400)]",
        over && "text-[var(--error)]",
        className,
      )}
    >
      {value.length} / {max}
    </div>
  );
}
