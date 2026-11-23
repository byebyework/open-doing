"use client";

import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";

import { filterTriggerClass } from "./TaskListFilters";

/**
 * 项目筛选（URL 驱动，看板 / 列表两视图共用）：挂在 tab 行右侧，读写
 * `?project={slug}`，服务端过滤两视图数据；切换时保留既有 `view` 与统计
 * 参数。选项文案带团队进度提示（`· NN%`，个人空间无进度不显示）。上方
 * 筛选条的项目下拉已由本组件接管。
 */

export interface TaskProjectFilterProps {
  projects: { id: string; name: string; slug: string }[];
  /** 项目进度（0~1，slug → 进度）；个人空间不传。 */
  projectProgress?: Record<string, number>;
  /** 「全部项目」的聚合进度；与 projectProgress 同时传入。 */
  allProjectsProgress?: number;
}

export function TaskProjectFilter({
  projects,
  projectProgress,
  allProjectsProgress,
}: TaskProjectFilterProps) {
  const t = useTranslations("kanban");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (projects.length === 0) return null;

  /** 原 SpaceKanbanFilterBar 的选项文案：有进度时按 `· NN%` 追加。 */
  function optionLabel(name: string, slug?: string): string {
    const progress =
      slug === undefined ? allProjectsProgress : projectProgress?.[slug];
    return progress === undefined
      ? name
      : `${name} · ${Math.round(progress * 100)}%`;
  }

  const activeSlug = searchParams.get("project");
  const activeProject = projects.find((project) => project.slug === activeSlug);
  const label =
    activeProject?.name ??
    (activeSlug ? activeSlug : t("filterAll"));

  function selectProject(slug: string | null) {
    const params = new URLSearchParams(searchParams);
    if (slug) {
      params.set("project", slug);
    } else {
      params.delete("project");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="task-filter-project"
          className={filterTriggerClass(Boolean(activeSlug))}
        >
          <span className="text-[var(--ink-400)]">
            {t("filterProjectLabel")}
          </span>
          <span className="max-w-[120px] truncate font-medium">{label}</span>
          <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuItem
          data-testid="task-filter-project-option-all"
          onSelect={() => selectProject(null)}
        >
          <span className="flex-1">{optionLabel(t("filterAll"))}</span>
        </DropdownMenuItem>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            data-testid={`task-filter-project-option-${project.slug}`}
            onSelect={() => selectProject(project.slug)}
          >
            <span className="flex-1">{optionLabel(project.name, project.slug)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
