"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { HintBadge } from "@/components/ui/HintBadge";
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
}

/**
 * 空间看板筛选条（对照 `space-kanban-*.html`）。
 *
 * 受控于 URL：变更即 `router.push` 重写 query，RSC 按新参数重新取数。
 * 契约：`?assignee=unassigned`（仅团队）；未设置即全部。项目筛选已由
 * 右侧 URL 驱动的 `TaskProjectFilter` 接管，本组件不再渲染项目下拉。
 */

export function SpaceKanbanFilterBar({
  variant,
  basePath,
  unassignedOnly = false,
  statParams,
  caption,
  todayCaption,
}: SpaceKanbanFilterBarProps) {
  const router = useRouter();
  // 双视图（TasksViewTabs）切换是纯客户端 replaceState，RSC 的 props 感知不到；
  // 筛选导航必须读实时 URL，否则列表视图下切筛选会把用户甩回看板。
  const viewParam = useSearchParams().get("view");
  const t = useTranslations("kanban");
  const tTasks = useTranslations("tasks");
  const tDate = useTranslations("date");

  /** 把未指派筛选写回 URL；取消回到无 query 的干净地址（保留统计参数）。 */
  function pushFilter(onlyUnassigned: boolean) {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(statParams ?? {})) {
      params.set(key, value);
    }
    if (variant === "team" && onlyUnassigned) {
      params.set("assignee", "unassigned");
    }
    if (viewParam === "list") params.set("view", "list");

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2.5">
      {variant === "team" ? (
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
      ) : null}

      {/* 实时筛选状态常驻触发器摘要（SSR 可见），解释性口径放进弹层。 */}
      {/* 项目名可能很长：容器限制最大宽度，摘要 span 省略号截断，
          避免在 375px 等窄视口下把筛选条（乃至页面）撑出横向溢出。 */}
      <div className="min-w-0 max-w-full [&>button]:max-w-full [&_span]:truncate">
        <HintBadge
          ariaLabel={t("captionHintAria")}
          summary={caption}
          title={t("captionHintTitle")}
          items={
            variant === "team"
              ? [t("captionHintScope"), t("captionHintScopeTeam"), t("captionHintCount")]
              : [t("captionHintScope"), t("captionHintCount")]
          }
        />
      </div>
      <span className="flex-1" />
      <HintBadge
        ariaLabel={tDate("todayHintAria")}
        summary={todayCaption}
        title={tDate("todayHintTitle")}
        items={[tDate("todayHintItem")]}
      />
    </div>
  );
}
