"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";

/** 团队空间看板指派筛选条入参。 */
export interface SpaceKanbanFilterBarProps {
  /**
   * `routes.ts` 生成的空间 Kanban 路径。
   *
   * query 在其上叠加（`URLSearchParams`），避免在组件里拼字面量 URL；
   * routes.ts 目前不提供带 query 的构造器。
   */
  basePath: string;
  /** 是否只显示未指派任务（`?assignee=unassigned`）。 */
  unassignedOnly?: boolean;
}

/**
 * 团队空间看板指派筛选条（对照 `space-kanban-*.html`）。
 *
 * 受控于 URL：变更即 `router.push` 重写 query，RSC 按新参数重新取数。
 * 契约：`?assignee=unassigned`；未设置即全部。项目筛选已由右侧
 * URL 驱动的 `TaskProjectFilter` 接管，本组件不再渲染项目下拉；
 * 「当前筛选 / 基准日期」两条常驻提示按需求移除，计数与日期口径
 * 不再在筛选条上展示。
 */
export function SpaceKanbanFilterBar({
  basePath,
  unassignedOnly = false,
}: SpaceKanbanFilterBarProps) {
  const router = useRouter();
  // 双视图（TasksViewTabs）切换是纯客户端 replaceState，RSC 的 props 感知不到；
  // pushFilter 复制实时 URL 参数（project/view/统计），只动自己的 assignee。
  const currentParams = useSearchParams();
  const t = useTranslations("kanban");
  const tTasks = useTranslations("tasks");

  /** 把未指派筛选写回 URL；只动 `assignee`，其余参数（project/view/统计）原样保留。 */
  function pushFilter(onlyUnassigned: boolean) {
    // 复制实时 URL 参数而非从 props 重建：project（TaskProjectFilter 写入）、
    // view（TasksViewTabs replaceState 写入）RSC props 感知不到，重建会丢。
    const params = new URLSearchParams(currentParams);

    if (onlyUnassigned) {
      params.set("assignee", "unassigned");
    } else {
      params.delete("assignee");
    }

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="mt-6 flex min-w-0 flex-wrap items-center gap-2.5">
      <Tabs
        value={unassignedOnly ? "unassigned" : "all"}
        onValueChange={(value) => {
          pushFilter(value === "unassigned");
        }}
      >
        <TabsList
          data-testid="kanban-assignee-filter"
          aria-label={t("filterByAssignee")}
        >
          <TabsTrigger value="all">{t("allTasks")}</TabsTrigger>
          <TabsTrigger value="unassigned">{tTasks("unassigned")}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
