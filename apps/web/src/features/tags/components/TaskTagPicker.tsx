"use client";

import { CheckIcon, PlusIcon, TagIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Tag } from "@open-doing/types";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";

import { tagColorStyle } from "./tag-colors";
import { TagPill } from "./TagPill";

/** 空间定位（与 TagManagerDialog 同形）。 */
export type PickerSpace = { kind: "team"; teamId: string } | { kind: "personal" };

/** TaskTagPicker 入参：受控多选，表单内随提交带上 tagIds。 */
export interface TaskTagPickerProps {
  space: PickerSpace;
  /** 当前空间标签池（RSC 注入）。 */
  pool: Tag[];
  value: string[];
  onChange: (tagIds: string[]) => void;
  /** false 时只读渲染已选 pills（无打开按钮）。 */
  canEdit: boolean;
  /** 触发器形态：pills（表单默认）| icon（表格/详情统一编辑入口）。 */
  trigger?: "pills" | "icon";
}

/**
 * 标签多选选项列表（PopoverContent 内共用；表格单元格与表单同构交互）。
 *
 * 勾选态用图标 span：vendored Checkbox 本体是 <button>，嵌在 option button
 * 内会触发 HTML button-in-button 水合错误。
 */
export function TagOptionList({
  pool,
  value,
  onToggle,
}: {
  pool: Tag[];
  value: string[];
  onToggle: (tagId: string) => void;
}) {
  if (pool.length === 0) {
    return <EmptyPoolHint />;
  }

  return (
    <ul className="max-h-56 overflow-y-auto">
      {pool.map((tag) => {
        const checked = value.includes(tag.id);
        const style = tagColorStyle(tag.color);
        return (
          <li key={tag.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              data-testid={`task-tag-option-${tag.id}`}
              onClick={() => onToggle(tag.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--purple-08)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus-ring)]"
            >
              <span
                aria-hidden
                className="flex size-3.5 shrink-0 items-center justify-center rounded border border-[var(--line-300)]"
              >
                {checked ? (
                  <CheckIcon className="size-3 text-[var(--purple-600)]" />
                ) : null}
              </span>
              <span
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: style.color }}
                aria-hidden
              />
              <span className="truncate">{tag.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyPoolHint() {
  const t = useTranslations("tags");
  return (
    <p className="px-1 py-2 text-[13px] text-[var(--muted-foreground)]">{t("emptyPool")}</p>
  );
}

/**
 * 任务标签多选控件：popover + 选项列表（≤50 个标签无需虚拟化，spec §6.6）。
 *
 * `trigger="pills"`（表单默认）：AttrPill 同款胶囊，显示标签图标 + 已选 pills；
 * `trigger="icon"`（表格 / 详情统一编辑入口）：小图标按钮，pill 展示
 * 与编辑动作分离（Hallmark 审计：chips represent values，动作集中一处）。
 * `canEdit=false` 时退化为已选标签的只读 pills。
 */
export function TaskTagPicker({
  pool,
  value,
  onChange,
  canEdit,
  trigger = "pills",
}: TaskTagPickerProps) {
  const t = useTranslations("tags");
  const [open, setOpen] = useState(false);

  const selected = pool.filter((tag) => value.includes(tag.id));

  function toggle(tagId: string): void {
    onChange(
      value.includes(tagId)
        ? value.filter((id) => id !== tagId)
        : [...value, tagId],
    );
  }

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-1">
        {selected.map((tag) => (
          <TagPill key={tag.id} name={tag.name} color={tag.color} />
        ))}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger === "icon" ? (
          <button
            type="button"
            data-testid="task-tag-picker-trigger"
            className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--line-200)] bg-transparent text-[var(--muted-foreground)] transition-colors hover:bg-[var(--purple-08)] hover:text-[var(--purple-600)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus-ring)]"
            aria-label={t("editTags")}
            aria-expanded={open}
          >
            <PlusIcon className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            data-testid="task-tag-picker-trigger"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[13px] leading-none text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
            aria-label={t("editTags")}
            aria-expanded={open}
          >
            <span className="text-[var(--color-text-muted)]">
              <TagIcon className="size-3.5" aria-hidden />
            </span>
            {selected.length === 0 ? (
              <span>{t("tagPickerEmpty")}</span>
            ) : (
              selected.map((tag) => (
                <TagPill key={tag.id} name={tag.name} color={tag.color} />
              ))
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2" data-testid="task-tag-picker-content">
        <TagOptionList pool={pool} value={value} onToggle={toggle} />
      </PopoverContent>
    </Popover>
  );
}
