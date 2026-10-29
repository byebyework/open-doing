"use client";

import { Segmented, Select } from "antd";
import { useRouter } from "next/navigation";

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
  /** 「当前筛选：{项目} · N 个任务」。 */
  caption: string;
  /** 「基准日期 YYYY-MM-DD（周X）」。 */
  todayCaption: string;
}

/**
 * 空间看板筛选条（对照 `space-kanban-*.html`）。
 *
 * 受控于 URL：变更即 `router.push` 重写 query，RSC 按新参数重新取数。
 * 契约：`?project={slug}`（两空间）、`?assignee=unassigned`（仅团队）；
 * 未设置即全部。
 */
export function SpaceKanbanFilterBar({
  variant,
  basePath,
  projects,
  activeProjectSlug,
  unassignedOnly = false,
  caption,
  todayCaption,
}: SpaceKanbanFilterBarProps) {
  const router = useRouter();

  /** 把筛选状态写回 URL；空筛选回到无 query 的干净地址。 */
  function pushFilter(projectSlug?: string, onlyUnassigned = false) {
    const params = new URLSearchParams();

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
        aria-label="按项目筛选"
        value={activeProjectSlug ?? ""}
        onChange={(value: string) => {
          pushFilter(value || undefined, unassignedOnly);
        }}
        options={[
          { value: "", label: "全部项目" },
          ...projects.map((project) => ({
            value: project.slug,
            label: project.name,
          })),
        ]}
        style={{ minWidth: 168 }}
      />

      {variant === "team" ? (
        <Segmented<"all" | "unassigned">
          aria-label="指派筛选"
          options={[
            { label: "全部任务", value: "all" },
            { label: "未指派", value: "unassigned" },
          ]}
          value={unassignedOnly ? "unassigned" : "all"}
          onChange={(value) => {
            pushFilter(activeProjectSlug, value === "unassigned");
          }}
        />
      ) : null}

      <span className="text-[12.5px] text-[#5f6368]">{caption}</span>
      <span className="flex-1" />
      <span className="text-[12.5px] text-[#9aa0a6]">{todayCaption}</span>
    </div>
  );
}
