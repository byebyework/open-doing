"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { PROJECT_TAB_PARAM, type ProjectTab } from "@/lib/project-tab";

export interface ProjectDetailTabsProps {
  /** 当前激活的 tab（RSC 从 `?tab=` 解析后传入）。 */
  active: ProjectTab;
}

/**
 * 详情页 tab 行（概览 / 任务 / 动态）：整页级导航，切 tab 走客户端
 * push，RSC 按新 searchParams 重取对应内容。
 *
 * URL 规则（`lib/project-tab.ts` 单一出口）：只增改 `tab` 参数，
 * 其余参数（列表 view/page/size、统计筛选等）原样保留——从任务 tab
 * 切走再切回不丢视图位置；概览删除 `tab` 保持干净地址。
 */
export function ProjectDetailTabs({ active }: ProjectDetailTabsProps) {
  const t = useTranslations("projects");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToTab(tab: ProjectTab) {
    const params = new URLSearchParams(searchParams);
    if (tab === "overview") {
      params.delete(PROJECT_TAB_PARAM);
    } else {
      params.set(PROJECT_TAB_PARAM, tab);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const tabs: Array<{ value: ProjectTab; label: string }> = [
    { value: "overview", label: t("tabOverview") },
    { value: "tasks", label: t("tabTasks") },
    { value: "activity", label: t("tabActivity") },
  ];

  return (
    <Tabs value={active} onValueChange={(value) => goToTab(value as ProjectTab)}>
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} data-value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
