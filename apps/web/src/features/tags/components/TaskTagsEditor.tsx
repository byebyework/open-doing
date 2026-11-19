"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { Tag } from "@open-doing/types";

import { setTaskTagsAction } from "../actions";
import { TaskTagPicker, type PickerSpace } from "./TaskTagPicker";
import { TaskTags } from "./TaskTags";

/** TaskTagsEditor 入参：详情页标签编辑区（即改即存）。 */
export interface TaskTagsEditorProps {
  taskId: string;
  /** 任务归属空间（透传 picker）。 */
  space: PickerSpace;
  /** 当前空间标签池（RSC 注入）。 */
  pool: Tag[];
  /** 任务当前标签（读路径已解析；被删标签不在内）。 */
  tags: Tag[];
  /** false 时只读展示 pills。 */
  canEdit: boolean;
}

/**
 * 任务详情页标签区：picker 多选，变更即调 `setTaskTagsAction`
 * （全量覆写；仅标签变更不推进 updated_at），成功后 router.refresh 拉新数据。
 * 失败 toast 并保留原值（action 层已保证不落库）。
 */
export function TaskTagsEditor({ taskId, space, pool, tags, canEdit }: TaskTagsEditorProps) {
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
      // 以服务端覆写结果为准：仅保留池内仍存在的标签（被删标签不会返回）。
      setCurrent(
        pool.filter((tag) => tagIds.includes(tag.id)),
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (pool.length === 0 && current.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-white px-3.5 py-3 shadow-[var(--shadow-rest)]" data-testid="task-tags-editor">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-[var(--muted-foreground)]">{t("tagNameLabel")}</span>
        <span className="flex-1" />
        {saving ? <span className="text-[12px] text-[var(--ink-400)]">…</span> : null}
      </div>
      <div className="mt-2">
        <TaskTagPicker
          space={space}
          pool={pool}
          value={current.map((tag) => tag.id)}
          onChange={onChange}
          canEdit={canEdit}
        />
      </div>
      {current.length > 0 && !canEdit ? (
        <div className="mt-2">
          <TaskTags tags={current} max={6} />
        </div>
      ) : null}
    </div>
  );
}
