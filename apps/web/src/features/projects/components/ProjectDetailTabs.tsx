"use client";

import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { OD_EASE, OD_MS } from "@/components/ui/overlay-motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { PROJECT_TAB_PARAM, type ProjectTab } from "@/lib/project-tab";

/** 激活指示胶囊的 layoutId：三个 tab 共享，切换时胶囊滑动（先例 TasksViewTabs）。 */
const ACTIVE_PILL_LAYOUT_ID = "project-detail-active-pill";

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
      {/* 胶囊轨道 + `!` 中和 vendored 触发器的静态激活底/影：底色只由滑动胶囊提供。 */}
      <TabsList className="gap-0.5 rounded-[var(--radius-pill)] bg-(--ink-900)/[0.04]! rounded-[var(--radius-pill)]! p-[3px]">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            data-value={tab.value}
            className="relative rounded-[var(--radius-pill)] px-3 text-[13px] data-[state=active]:bg-transparent! data-[state=active]:shadow-none! data-[state=active]:font-semibold"
          >
            {tab.value === active ? (
              <motion.span
                layoutId={ACTIVE_PILL_LAYOUT_ID}
                aria-hidden="true"
                className="absolute inset-0 rounded-[var(--radius-pill)] bg-card shadow-sm"
                transition={{ duration: OD_MS.popIn / 1000, ease: OD_EASE.springIn }}
              />
            ) : null}
            <span className="relative z-10">{tab.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
