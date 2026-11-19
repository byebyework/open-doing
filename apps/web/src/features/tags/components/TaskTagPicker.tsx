"use client";

import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Tag } from "@open-doing/types";

import { Checkbox } from "@/components/ui/shadcn/checkbox";
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
}

/**
 * 任务标签多选控件：popover + checkbox 列表（≤50 个标签无需虚拟化，spec §6.6）。
 *
 * 勾选/取消即时回调 toggle 后的全量 tagIds；pool 为空时给出「先建标签」提示。
 * `canEdit=false` 时退化为已选标签的只读 pills。
 */
export function TaskTagPicker({ pool, value, onChange, canEdit }: TaskTagPickerProps) {
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
        <button
          type="button"
          data-testid="task-tag-picker-trigger"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--line-200)] bg-transparent px-2 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--purple-08)]"
          aria-label={t("tagColorLabel") + "/" + t("tagNameLabel")}
        >
          {selected.length === 0 ? (
            <>
              <PlusIcon className="size-3.5" aria-hidden />
              <span>{t("tagPickerEmpty")}</span>
            </>
          ) : (
            <>
              {selected.map((tag) => (
                <TagPill key={tag.id} name={tag.name} color={tag.color} />
              ))}
            </>
          )}
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2" data-testid="task-tag-picker-content">
        {pool.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-[var(--muted-foreground)]">{t("emptyPool")}</p>
        ) : (
          <ul className="max-h-56 overflow-y-auto">
            {pool.map((tag) => {
              const checked = value.includes(tag.id);
              const style = tagColorStyle(tag.color);
              return (
                <li key={tag.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    data-testid={`task-tag-option-${tag.id}`}
                    onClick={() => toggle(tag.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--purple-08)]"
                  >
                    <Checkbox checked={checked} aria-hidden tabIndex={-1} />
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
        )}
      </PopoverContent>
    </Popover>
  );
}
