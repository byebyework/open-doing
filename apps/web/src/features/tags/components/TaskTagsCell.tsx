"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { Tag } from "@open-doing/types";

import { setTaskTagsAction } from "../actions";
import { TaskTagPicker, type PickerSpace } from "./TaskTagPicker";
import { TaskTags } from "./TaskTags";

/** TaskTagsCell 入参：表格标签列 / 详情行内标签行的统一单元。 */
export interface TaskTagsCellProps {
  taskId: string;
  space: PickerSpace;
  /** 当前空间标签池（RSC 注入）。 */
  pool: Tag[];
  /** 任务当前标签（读路径已解析；被删标签不在内）。 */
  tags: Tag[];
  /** false 时只读 pills，无编辑入口。 */
  canEdit: boolean;
  /** 展示上限（表格 2，详情 6）。 */
  max?: number;
}

/**
 * 标签单元（Hallmark 审计定稿）：pill 一律静态展示，编辑动作集中到行尾
 * 统一入口（icon popover，即改即存走 setTaskTagsAction）；
 * 空标签且可编辑时常驻低对比 ghost 按钮（键盘可达，非 hover 揭示）。
 */
export function TaskTagsCell({ taskId, space, pool, tags, canEdit, max = 2 }: TaskTagsCellProps) {
  const t = useTranslations("tags");
  const router = useRouter();
  const [current, setCurrent] = useState<Tag[]>(tags);
  const [saving, setSaving] = useState(false);

  async function onChange(tagIds: string[]): Promise<void> {
    setSaving(true);
    try {
      const result = await setTaskTagsAction({ taskId, tagIds });
      if (!result.ok) {
        toast.error(result.errors.form ?? result.errors.tags ?? t("tagInvalidForSpace"));
        return;
      }
      setCurrent(pool.filter((tag) => tagIds.includes(tag.id)));
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const isEmpty = current.length === 0;

  if (!canEdit) {
    return isEmpty ? (
      <span className="text-[12.5px] text-[var(--ink-400)]">—</span>
    ) : (
      <TaskTags tags={current} max={max} />
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="task-tags-cell">
      {isEmpty ? null : <TaskTags tags={current} max={max} />}
      <TaskTagPicker
        space={space}
        pool={pool}
        value={current.map((tag) => tag.id)}
        onChange={onChange}
        canEdit
        trigger="icon"
      />
      {saving ? <span className="text-[11px] text-[var(--ink-400)]">…</span> : null}
    </span>
  );
}
