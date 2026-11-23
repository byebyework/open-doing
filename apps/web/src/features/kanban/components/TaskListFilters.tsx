"use client";

import type { TaskPriority, TaskStatus } from "@open-doing/types";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { cn } from "@/lib/utils";

import { useListFilters } from "../list-filters-context";

/**
 * 列表视图本地筛选组（状态 / 优先级）：挂在看板/列表 tab 行右侧，仅列表
 * 视图渲染。筛选只改客户端行数据，不读写 URL（与上方服务端筛选条语义
 * 独立）。项目筛选由 URL 驱动的 `TaskProjectFilter` 承担（两视图共用）。
 * 选项文案沿用既有的 kanban / tasks 命名空间键。
 */

const STATUS_OPTIONS = [
  { value: "todo", labelKey: "colTodo" },
  { value: "in_progress", labelKey: "colInProgress" },
  { value: "done", labelKey: "colDone" },
] as const satisfies readonly {
  value: TaskStatus;
  labelKey: "colTodo" | "colInProgress" | "colDone";
}[];

const PRIORITY_OPTIONS = [
  { value: "high", labelKey: "priorityHigh" },
  { value: "medium", labelKey: "priorityMedium" },
  { value: "low", labelKey: "priorityLow" },
] as const satisfies readonly {
  value: TaskPriority;
  labelKey: "priorityHigh" | "priorityMedium" | "priorityLow";
}[];

/** 触发器基础样式：label（弱化）+ 当前值 + chevron；选中非「全部」时高亮。 */
const TRIGGER_BASE =
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 text-[12.5px] leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]";

export function filterTriggerClass(active: boolean): string {
  return cn(
    TRIGGER_BASE,
    active
      ? "border-[var(--primary)] bg-(--primary-bg) text-primary"
      : "border-[var(--border-default)] bg-(--surface-white) text-[var(--ink-500)] hover:text-[var(--ink-900)]",
  );
}

/** 菜单项：选中项打勾（筛选语义，不禁用——再选一次可保持当前值并关闭）。 */
function FilterOption({
  testid,
  label,
  selected,
  onSelect,
}: {
  testid: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem data-testid={testid} onSelect={onSelect}>
      <span className="flex-1">{label}</span>
      {selected ? <CheckIcon aria-hidden className="size-3.5" /> : null}
    </DropdownMenuItem>
  );
}

export function TaskListFilters() {
  const t = useTranslations("kanban");
  const tTasks = useTranslations("tasks");
  const { filters, setFilter } = useListFilters();

  const statusLabel =
    filters.status === "all"
      ? t("filterAll")
      : t(
          STATUS_OPTIONS.find((option) => option.value === filters.status)!
            .labelKey,
        );
  const priorityLabel =
    filters.priority === "all"
      ? t("filterAll")
      : tTasks(
          PRIORITY_OPTIONS.find(
            (option) => option.value === filters.priority,
          )!.labelKey,
        );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="task-filter-status"
            className={filterTriggerClass(filters.status !== "all")}
          >
            <span className="text-[var(--ink-400)]">
              {t("filterStatusLabel")}
            </span>
            <span className="font-medium">{statusLabel}</span>
            <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[132px]">
          <FilterOption
            testid="task-filter-status-option-all"
            label={t("filterAll")}
            selected={filters.status === "all"}
            onSelect={() => setFilter({ status: "all" })}
          />
          {STATUS_OPTIONS.map((option) => (
            <FilterOption
              key={option.value}
              testid={`task-filter-status-option-${option.value}`}
              label={t(option.labelKey)}
              selected={filters.status === option.value}
              onSelect={() => setFilter({ status: option.value })}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="task-filter-priority"
            className={filterTriggerClass(filters.priority !== "all")}
          >
            <span className="text-[var(--ink-400)]">
              {t("filterPriorityLabel")}
            </span>
            <span className="font-medium">{priorityLabel}</span>
            <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[132px]">
          <FilterOption
            testid="task-filter-priority-option-all"
            label={t("filterAll")}
            selected={filters.priority === "all"}
            onSelect={() => setFilter({ priority: "all" })}
          />
          {PRIORITY_OPTIONS.map((option) => (
            <FilterOption
              key={option.value}
              testid={`task-filter-priority-option-${option.value}`}
              label={tTasks(option.labelKey)}
              selected={filters.priority === option.value}
              onSelect={() => setFilter({ priority: option.value })}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

    </div>
  );
}
