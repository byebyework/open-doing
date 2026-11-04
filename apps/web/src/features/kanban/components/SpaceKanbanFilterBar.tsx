"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";

/** 空间看板筛选条入参（个人 / 团队共用，团队多一个未指派筛选）。 */
export interface SpaceKanbanFilterBarProps {
  variant: "personal" | "team";
  /**
   * `routes.ts` 生成的空间 Kanban 路径。
   *
   * query 在其上叠加（`URLSearchParams`），避免在组件里拼字面量 URL；
   * routes.ts 目前不提供带 query 的构造器。
   */
  basePath: string;
  /** 可筛选的项目（已按当前空间可见范围过滤）。 */
  projects: { id: string; name: string; slug: string }[];
  /** 当前 URL 命中的项目 slug；无效 / 外部 slug 已在 RSC 侧回退为 undefined。 */
  activeProjectSlug?: string;
  /** 团队空间：是否只显示未指派任务（`?assignee=unassigned`）。 */
  unassignedOnly?: boolean;
  /**
   * 当前激活的统计参数（status / overdue / dueSoon）；`pushFilter` 重写 URL
   * 时透传——项目 / 负责人是统计视角内的细化，切换细化不退出视角。
   */
  statParams?: Record<string, string>;
  /** 「当前筛选：{项目} · N 个任务」。 */
  caption: string;
  /** 「基准日期 YYYY-MM-DD（周X）」。 */
  todayCaption: string;
  /** 项目进度（0~1，slug → progress）；传入时选项文案追加 `· NN%`。 */
  projectProgress?: Record<string, number>;
  /** 「全部项目」的聚合进度（0~1）；与 `projectProgress` 同时传入。 */
  allProjectsProgress?: number;
}

/**
 * 空间看板筛选条（对照 `space-kanban-*.html`）。
 *
 * 受控于 URL：变更即 `router.push` 重写 query，RSC 按新参数重新取数。
 * 契约：`?project={slug}`（两空间）、`?assignee=unassigned`（仅团队）；
 * 未设置即全部。
 */

/** 「全部项目」在 Radix Select 里的哨兵值（item value 不允许空字符串）。 */
const ALL_PROJECTS = "__all__";
export function SpaceKanbanFilterBar({
  variant,
  basePath,
  projects,
  activeProjectSlug,
  unassignedOnly = false,
  statParams,
  caption,
  todayCaption,
  projectProgress,
  allProjectsProgress,
}: SpaceKanbanFilterBarProps) {
  const router = useRouter();
  const t = useTranslations("kanban");
  const tTasks = useTranslations("tasks");

  /** 选项文案：有进度时按原型追加 `· NN%`。 */
  function optionLabel(name: string, slug?: string): string {
    const progress =
      slug === undefined ? allProjectsProgress : projectProgress?.[slug];
    return progress === undefined
      ? name
      : `${name} · ${Math.round(progress * 100)}%`;
  }

  /** 把筛选状态写回 URL；空筛选回到无 query 的干净地址。 */
  function pushFilter(projectSlug?: string, onlyUnassigned = false) {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(statParams ?? {})) {
      params.set(key, value);
    }
    if (projectSlug) params.set("project", projectSlug);
    if (variant === "team" && onlyUnassigned) {
      params.set("assignee", "unassigned");
    }

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2.5">
      <Select
        value={activeProjectSlug ?? ALL_PROJECTS}
        onValueChange={(value) => {
          pushFilter(value === ALL_PROJECTS ? undefined : value, unassignedOnly);
        }}
      >
        <SelectTrigger
          className="w-[168px]"
          data-testid="kanban-project-filter"
          aria-label={t("filterByProject")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PROJECTS}>
            {optionLabel(t("allProjects"))}
          </SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.slug} value={project.slug}>
              {optionLabel(project.name, project.slug)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {variant === "team" ? (
        <Tabs
          value={unassignedOnly ? "unassigned" : "all"}
          onValueChange={(value) => {
            pushFilter(activeProjectSlug, value === "unassigned");
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
      ) : null}

      <span className="text-[12.5px] text-[#5f6368]">{caption}</span>
      <span className="flex-1" />
      <span className="text-[12.5px] text-[#9aa0a6]">{todayCaption}</span>
    </div>
  );
}
