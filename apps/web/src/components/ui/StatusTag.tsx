"use client";

import type { TaskStatus } from "@open-doing/types";
import { Badge } from "@/components/ui/shadcn/badge";
import { useTranslations } from "next-intl";

/** StatusTag 入参。 */
export interface StatusTagProps {
  /** 任务状态：todo / in_progress / done。 */
  status: TaskStatus;
}

/** 状态 → Badge 变体与文案 key（变体颜色取 tokens.css 状态色组 --status-*）。 */
const STATUS_VARIANT: Record<TaskStatus, { labelKey: string; variant: "neutral" | "info" | "success" }> = {
  todo: { labelKey: "notStarted", variant: "neutral" },
  in_progress: { labelKey: "inProgress", variant: "info" },
  done: { labelKey: "completed", variant: "success" },
};

/**
 * 任务状态标签：未开始 / 进行中 / 已完成。
 *
 * shadcn Badge 的 pill 填充形态，颜色取状态色组；文案来自 status 命名空间。
 */
export function StatusTag({ status }: StatusTagProps) {
  const t = useTranslations("status");
  const { labelKey, variant } = STATUS_VARIANT[status];

  return (
    <Badge
      variant={variant}
      className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
    >
      {t(labelKey as "notStarted")}
    </Badge>
  );
}
