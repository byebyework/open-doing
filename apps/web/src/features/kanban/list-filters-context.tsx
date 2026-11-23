"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_LIST_FILTERS, type ListFilters } from "./sort-task-rows";

/** TasksViewTabs 侧筛选 UI 依赖的上下文契约。 */
export interface ListFiltersContextValue {
  filters: ListFilters;
  setFilter: (patch: Partial<ListFilters>) => void;
}

/** 无 provider（单测 / 独立渲染）时的兜底：全 "all"、setFilter 空操作。 */
const FALLBACK_VALUE: ListFiltersContextValue = {
  filters: DEFAULT_LIST_FILTERS,
  setFilter: () => {},
};

const ListFiltersContext = createContext<ListFiltersContextValue | null>(null);

export function ListFiltersProvider({
  value,
  children,
}: {
  value: ListFiltersContextValue;
  children: ReactNode;
}) {
  return (
    <ListFiltersContext.Provider value={value}>
      {children}
    </ListFiltersContext.Provider>
  );
}

/** 读取列表筛选；无 provider 时返回兜底值（容忍独立渲染）。 */
export function useListFilters(): ListFiltersContextValue {
  return useContext(ListFiltersContext) ?? FALLBACK_VALUE;
}
