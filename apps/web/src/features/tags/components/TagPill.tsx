import type { TagColor } from "@open-doing/types";

import { tagColorStyle } from "./tag-colors";

/** TagPill 入参：名称 + 预设色板 key；sm 用于卡片 / 表格行，md 用于管理面板。 */
export interface TagPillProps {
  name: string;
  color: TagColor;
  size?: "sm" | "md";
}

/**
 * 标签 pill：accent 色文字 + 同名 `-bg` 半透明底（对齐 PriorityChip / StatusTag
 * 的「色字彩底」节奏）。纯展示组件，服务端 / 客户端均可用。
 */
export function TagPill({ name, color, size = "sm" }: TagPillProps) {
  const style = tagColorStyle(color);
  const sizeClassName =
    size === "md"
      ? "px-2.5 py-1 text-[13px] gap-1"
      : "px-2 py-0.5 text-xs";

  return (
    <span
      data-testid="tag-pill"
      className={`inline-flex max-w-full items-center truncate rounded-full font-medium whitespace-nowrap ${sizeClassName}`}
      style={{ color: style.color, backgroundColor: style.backgroundColor }}
    >
      {name}
    </span>
  );
}
