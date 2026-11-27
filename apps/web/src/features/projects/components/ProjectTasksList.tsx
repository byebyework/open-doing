"use client";

import { useState, type ReactNode } from "react";

import { TaskListFilters } from "@/features/kanban/components/TaskListFilters";
import {
  ListFiltersProvider,
  type TagFilterOption,
} from "@/features/kanban/list-filters-context";
import type { ListFilters } from "@/features/kanban/sort-task-rows";

export interface ProjectTasksListProps {
  /** RSC 从 `?status=&priority=&tag=` 解析出的初始筛选。 */
  initialFilters: ListFilters;
  /** 标签筛选选项（task 标签池切片）；空数组不渲染标签下拉。 */
  tagOptions: TagFilterOption[];
  /** 里程碑筛选选项（当前项目里程碑）；空数组不渲染里程碑下拉。 */
  milestoneOptions: TagFilterOption[];
  /** 列表本体（RSC 组装的 SpaceTaskTable）。 */
  children: ReactNode;
}

/** 筛选字段 → URL 参数名（"all" 即删参，保持干净地址）。 */
const FILTER_PARAM: Array<{
  key: "status" | "priority" | "tag";
  field: keyof ListFilters;
}> = [
  { key: "status", field: "status" },
  { key: "priority", field: "priority" },
  { key: "tag", field: "tag" },
];

/**
 * 项目任务 tab 的列表容器：持有列表筛选 state，变更即镜像进 URL
 * （replaceState，不触发 RSC——行数据整批在手，收窄本就在客户端）。
 *
 * URL 镜像是 `key={tab}` 重挂后筛选不丢的唯一保障：离开再回来时 RSC
 * 用 `parseProjectTaskFilters` 还原 `initialFilters`。
 */
export function ProjectTasksList({
  initialFilters,
  tagOptions,
  milestoneOptions,
  children,
}: ProjectTasksListProps) {
  const [filters, setFilters] = useState<ListFilters>(initialFilters);

  function setFilter(patch: Partial<ListFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);

    const url = new URL(window.location.href);
    for (const { key, field } of FILTER_PARAM) {
      const value = next[field];
      if (value === "all") url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    window.history.replaceState(null, "", url);
  }

  return (
    <ListFiltersProvider value={{ filters, setFilter, tagOptions, milestoneOptions }}>
      <div className="mt-1 flex flex-col gap-4">
        <TaskListFilters />
        {children}
      </div>
    </ListFiltersProvider>
  );
}
