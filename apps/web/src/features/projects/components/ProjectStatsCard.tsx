import type { ProjectHealthKind, ProjectStats } from "@open-doing/types";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Badge } from "@/components/ui/shadcn/badge";
import { Progress } from "@/components/ui/shadcn/progress";

/** e2e / 组件测试锚定卡片用的 testid(与 TEST_IDS.projects.projectsListCard 一致)。 */
export const PROJECT_CARD_TEST_ID = "projects-list-card";

/** 卡片入参:`stats`/`health` 由列表页 RSC 算好传入,本组件保持无状态展示。 */
export interface ProjectStatsCardProps {
  name: string;
  description?: string;
  href: string;
  stats: ProjectStats;
  health: ProjectHealthKind;
}

/** 徽标与进度条/pct 的颜色映射(对齐原型 16/17:逾期红 / 临期黄 / 正常绿)。 */
const HEALTH_STYLE: Record<
  ProjectHealthKind,
  { badgeVariant: "warning" | "neutral" | "success" | undefined; badgeClassName?: string; bar: string; pct: string }
> = {
  overdue: {
    badgeVariant: undefined,
    badgeClassName: "bg-[var(--status-overdue-bg)] text-[var(--error)]",
    bar: "var(--error)",
    pct: "var(--error)",
  },
  dueSoon: {
    badgeVariant: "warning",
    bar: "var(--warning)",
    pct: "var(--status-due-soon)",
  },
  notStarted: {
    badgeVariant: "neutral",
    bar: "var(--primary)",
    pct: "var(--muted-foreground)",
  },
  normal: {
    badgeVariant: "success",
    bar: "var(--success)",
    pct: "var(--success)",
  },
};

const HEALTH_LABEL_KEY = {
  overdue: "healthOverdue",
  dueSoon: "healthDueSoon",
  notStarted: "healthNotStarted",
  normal: "healthNormal",
} as const;

/**
 * 项目统计卡片(空间级项目列表,v1.2;原型 `space-projects-*.html`)。
 *
 * 纯展示组件:RSC 与 client 均可渲染,无本地状态;点击整卡进入项目详情。
 */
export function ProjectStatsCard({
  name,
  description,
  href,
  stats,
  health,
}: ProjectStatsCardProps) {
  const t = useTranslations("projects");
  const style = HEALTH_STYLE[health];
  const percent = Math.round(stats.progress * 100);

  return (
    <Link
      href={href}
      data-testid={PROJECT_CARD_TEST_ID}
      className="block rounded-xl border border-[var(--border)] bg-card p-4 text-inherit no-underline shadow-sm transition-[border-color,box-shadow] hover:border-[var(--primary)] hover:shadow-[0_6px_18px_rgba(15,23,42,0.08)]"
    >
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--ink-900)]">
          {name}
        </span>
        <Badge
          variant={style.badgeVariant}
          className={style.badgeClassName}
        >
          {t(HEALTH_LABEL_KEY[health])}
        </Badge>
      </div>
      {description ? (
        <p className="mb-3.5 line-clamp-2 min-h-[34px] text-[12.5px] leading-5 text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
      <Progress value={stats.progress} color={style.bar} className="h-[6px]" aria-label={`${name} ${percent}%`} />
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="text-[15px] font-bold tabular-nums"
          style={{ color: style.pct }}
        >
          {percent}%
        </span>
        <span className="ml-auto text-xs tabular-nums text-[var(--muted-foreground)]">
          {t("cardTasks", { count: stats.taskCount })} ·{" "}
          {t("cardDone", { count: stats.doneCount })}
          {stats.overdueCount > 0
            ? ` · ${t("cardOverdue", { count: stats.overdueCount })}`
            : ""}
        </span>
      </div>
    </Link>
  );
}
