import type { Tag } from "@open-doing/types";

import { TagPill } from "./TagPill";

/** TaskTags 入参：已解析的标签数组 + 折叠上限。 */
export interface TaskTagsProps {
  tags: Tag[];
  /** 最多直接展示的 pill 数，默认 3；多余折叠为 `+N`。 */
  max?: number;
}

/**
 * 任务标签展示行：看板卡片 / 任务表格用。
 * 调用方只传「仍存在」的标签（已删除标签由数据组装层过滤），空数组不渲染。
 */
export function TaskTags({ tags, max = 3 }: TaskTagsProps) {
  if (tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;

  return (
    <span className="inline-flex items-center gap-1" data-testid="task-tags">
      {visible.map((tag) => (
        <TagPill key={tag.id} name={tag.name} color={tag.color} />
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex items-center rounded-full px-1.5 text-xs font-medium text-[var(--ink-400)]"
          title={tags.slice(max).map((tag) => tag.name).join(", ")}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
