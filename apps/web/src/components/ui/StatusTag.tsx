"use client";

import type { TaskStatus } from "@open-doing/types";
import { Tag } from "antd";

/** StatusTag 入参。 */
export interface StatusTagProps {
  /** 任务状态：todo / in_progress / done。 */
  status: TaskStatus;
}

/** 状态 → 文案与配色（取值自设计令牌：未开始灰 / 进行中紫 / 已完成绿）。 */
const STATUS_STYLE: Record<
  TaskStatus,
  { label: string; color: string; background: string }
> = {
  todo: { label: "未开始", color: "#5f6368", background: "#f4f5f7" },
  in_progress: { label: "进行中", color: "#7d2ae8", background: "#eef0fc" },
  done: { label: "已完成", color: "#00b894", background: "rgba(0,184,148,0.1)" },
};

/**
 * 任务状态标签：未开始 / 进行中 / 已完成。
 *
 * 使用 antd Tag 的无边框填充形态，颜色对齐原型状态配色。
 */
export function StatusTag({ status }: StatusTagProps) {
  const { label, color, background } = STATUS_STYLE[status];

  return (
    <Tag
      variant="filled"
      style={{
        marginInlineEnd: 0,
        border: "none",
        borderRadius: 9999,
        paddingInline: 8,
        color,
        background,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: "20px",
      }}
    >
      {label}
    </Tag>
  );
}
