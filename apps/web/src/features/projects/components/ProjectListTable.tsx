"use client";

import type { Tag, TaskPriority } from "@open-doing/types";
import type { ProjectStatusKind } from "@open-doing/types";
import { motion } from "motion/react";
import { FlagIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { TagPill } from "@/features/tags/components/TagPill";

/** 表格行（RSC 侧组装的可序列化数据；派生字段在页面算好传入）。 */
export interface ProjectListRow {
  id: string;
  name: string;
  description?: string;
  href: string;
  priority: TaskPriority;
  tags: Tag[];
  statusKind: ProjectStatusKind;
  /** 0–100 整数（RSC 侧 Math.round(progress*100)）。 */
  progressPercent: number;
  milestoneCount: number;
  startDate?: string;
  endDate?: string;
}

export interface ProjectListFilters {
  status: ProjectStatusKind | "all";
  priority: TaskPriority | "all";
  tagId: string | "all";
  keyword: string;
}

const STATUS_TABS: (ProjectStatusKind | "all")[] = [
  "all",
  "in_progress",
  "not_started",
  "completed",
];

/**
 * 客户端筛选（纯函数，单测锁定）：状态/优先级精确匹配，标签含于项目标签，
 * 关键字对名称不区分大小写子串匹配；条件之间 AND。
 */
export function filterProjectRows(
  rows: ProjectListRow[],
  filters: ProjectListFilters,
): ProjectListRow[] {
  const keyword = filters.keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== "all" && row.statusKind !== filters.status) return false;
    if (filters.priority !== "all" && row.priority !== filters.priority) return false;
    if (filters.tagId !== "all" && !row.tags.some((tag) => tag.id === filters.tagId)) {
      return false;
    }
    if (keyword && !row.name.toLowerCase().includes(keyword)) return false;
    return true;
  });
}

function statusPillClass(kind: ProjectStatusKind): string {
  switch (kind) {
    case "completed":
      return "bg-[var(--color-success-bg)] text-[var(--color-success)]";
    case "in_progress":
      return "bg-[var(--color-primary-bg)] text-[var(--color-primary)]";
    case "not_started":
      return "bg-[var(--color-todo-bg)] text-[var(--color-todo)]";
  }
}

function priorityPillClass(priority: TaskPriority): string {
  switch (priority) {
    case "high":
      return "bg-[var(--color-error-bg)] text-[var(--color-error)]";
    case "medium":
      return "bg-[var(--color-warning-bg)] text-[var(--color-warning)]";
    case "low":
      return "bg-[var(--color-todo-bg)] text-[var(--color-todo)]";
  }
}

const progressFillVar: Record<ProjectStatusKind, string> = {
  completed: "var(--color-success)",
  in_progress: "var(--color-progress)",
  not_started: "transparent",
};

/** 项目列表表格（对照原型 projects-list.png）：筛选栏 + 七列表格。 */
export function ProjectListTable({ rows }: { rows: ProjectListRow[] }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [filters, setFilters] = useState<ProjectListFilters>({
    status: "all",
    priority: "all",
    tagId: "all",
    keyword: "",
  });

  // 标签筛选项从行内标签去重派生（保持首次出现顺序）。
  const tagOptions = useMemo(() => {
    const seen = new Map<string, Tag>();
    for (const row of rows) {
      for (const tag of row.tags) {
        if (!seen.has(tag.id)) seen.set(tag.id, tag);
      }
    }
    return Array.from(seen.values());
  }, [rows]);

  const filtered = useMemo(() => filterProjectRows(rows, filters), [rows, filters]);

  const statusLabel = (kind: ProjectStatusKind) =>
    t(kind === "not_started" ? "statusNotStarted" : kind === "in_progress" ? "statusInProgress" : "statusCompleted");
  const priorityLabel = (priority: TaskPriority) =>
    t(priority === "high" ? "priorityHigh" : priority === "medium" ? "priorityMedium" : "priorityLow");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
        <Tabs
          value={filters.status}
          onValueChange={(next) =>
            setFilters((current) => ({
              ...current,
              status: next as ProjectListFilters["status"],
            }))
          }
        >
          <TabsList>
            {STATUS_TABS.map((kind) => (
              <TabsTrigger key={kind} value={kind} data-testid={`project-status-tab-${kind}`}>
                {kind === "all" ? t("filterAll") : statusLabel(kind)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={filters.priority}
            onValueChange={(next) =>
              setFilters((current) => ({
                ...current,
                priority: next as ProjectListFilters["priority"],
              }))
            }
          >
            <SelectTrigger className="w-[136px]" aria-label={t("colPriority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllPriorities")}</SelectItem>
              {(["high", "medium", "low"] as const).map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priorityLabel(priority)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.tagId}
            onValueChange={(next) =>
              setFilters((current) => ({ ...current, tagId: next }))
            }
          >
            <SelectTrigger className="w-[136px]" aria-label={t("colTags")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllTags")}</SelectItem>
              {tagOptions.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="search"
            data-testid="project-search-input"
            placeholder={t("searchPlaceholder")}
            className="w-[200px]"
            value={filters.keyword}
            onChange={(event) =>
              setFilters((current) => ({ ...current, keyword: event.target.value }))
            }
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[12.5px] text-[var(--color-text-muted)]">
              <th className="px-4 py-2.5 text-left font-medium">{t("colName")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colPriority")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colTags")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colStatus")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colProgress")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colMilestones")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colDates")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  data-testid="project-filter-empty"
                  className="px-4 py-10 text-center text-[var(--color-text-muted)]"
                >
                  {t("filterEmpty")}
                </td>
              </tr>
            ) : (
              filtered.map((row, index) => (
                <motion.tr
                  key={row.id}
                  data-testid="project-row"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  onClick={(event) => {
                    // 整行可点（对照原型文案）；名称 Link 已承担导航，避免重复 push。
                    const target = event.target as HTMLElement;
                    if (target.closest("a")) return;
                    router.push(row.href);
                  }}
                  className="cursor-pointer border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--color-surface-hover)]"
                >
                  <td className="px-4 py-3" data-testid={`project-row-${index}`}>
                    <Link href={row.href} className="group block min-w-0">
                      <span className="block truncate font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                        {row.name}
                      </span>
                      {row.description ? (
                        <span className="mt-0.5 block truncate text-[12.5px] text-[var(--color-text-muted)]">
                          {row.description}
                        </span>
                      ) : null}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityPillClass(row.priority)}`}
                    >
                      {priorityLabel(row.priority)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {row.tags.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {row.tags.map((tag) => (
                          <TagPill key={tag.id} name={tag.name} color={tag.color} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusPillClass(row.statusKind)}`}
                    >
                      {statusLabel(row.statusKind)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-progress-bg)]">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${row.progressPercent}%`,
                            backgroundColor: progressFillVar[row.statusKind],
                          }}
                        />
                      </span>
                      <span className="tabular-nums text-[var(--color-text-secondary)]">
                        {row.progressPercent}%
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {row.milestoneCount > 0 ? (
                      <span className="flex items-center gap-1.5 text-[var(--color-primary)]">
                        <FlagIcon className="size-3.5" aria-hidden="true" />
                        {t("milestoneCount", { count: row.milestoneCount })}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                    {row.startDate && row.endDate
                      ? `${row.startDate} ~ ${row.endDate}`
                      : (row.startDate ?? row.endDate ?? "-")}
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
