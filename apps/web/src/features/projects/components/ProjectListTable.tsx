"use client";

import type { ProjectMemberRef, ProjectStatus, Tag, TaskPriority } from "@open-doing/types";
import { PROJECT_STATUSES } from "@open-doing/types";
import { motion } from "motion/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { TagPill } from "@/features/tags/components/TagPill";
import { updatePersonalProjectStatusAction } from "@/features/personal/projects/actions";
import { updateTeamProjectStatusAction } from "../actions";
import { PROJECT_STATUS_COLORS } from "../constants";
import { ProjectDetailDrawer } from "./ProjectDetailDrawer";
import type { ProjectFormSpace } from "./ProjectForm";
import { ProjectStatusPill } from "./ProjectStatusPill";

/** 每页行数（客户端分页；筛选变化重置页码）。 */
const PAGE_SIZE = 10;

/** 表格行（RSC 侧组装的可序列化数据；派生字段在页面算好传入）。 */
export interface ProjectListRow {
  id: string;
  name: string;
  /** 一句话简述（行内第二行；缺省回落 description）。 */
  summary?: string;
  description?: string;
  href: string;
  priority: TaskPriority;
  tags: Tag[];
  status: ProjectStatus;
  /** 团队负责人；个人空间为 null。 */
  lead: ProjectMemberRef | null;
  /** 项目成员视图（团队空间组装；个人空间空数组）。 */
  members: ProjectMemberRef[];
  /** 0–100 整数（RSC 侧 Math.round(progress*100)）。 */
  progressPercent: number;
  milestoneCount: number;
  startDate?: string;
  endDate?: string;
  /** 任务统计（Drawer 概览用）。 */
  taskCount: number;
  doneCount: number;
  overdueCount: number;
}

export interface ProjectListFilters {
  status: ProjectStatus | "all";
  priority: TaskPriority | "all";
  tagId: string | "all";
  keyword: string;
}

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
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.priority !== "all" && row.priority !== filters.priority) return false;
    if (filters.tagId !== "all" && !row.tags.some((tag) => tag.id === filters.tagId)) {
      return false;
    }
    if (keyword && !row.name.toLowerCase().includes(keyword)) return false;
    return true;
  });
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

const progressFillVar: Record<ProjectStatus, string> = {
  backlog: "transparent",
  planned: "transparent",
  in_progress: "var(--color-progress)",
  completed: "var(--color-success)",
  canceled: "transparent",
};

/** 项目列表表格：筛选栏 + 客户端分页 + 行点击打开右侧详情 Drawer。 */
export function ProjectListTable({
  rows,
  space,
  canManage,
}: {
  rows: ProjectListRow[];
  space: ProjectFormSpace;
  /** 团队 owner/admin、个人 owner（状态就地改 + Drawer 里程碑管理入口）。 */
  canManage: boolean;
}) {
  const t = useTranslations("projects");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [filters, setFilters] = useState<ProjectListFilters>({
    status: "all",
    priority: "all",
    tagId: "all",
    keyword: "",
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ProjectListRow | null>(null);
  // 任一筛选变化重置回第 1 页：React 推荐的渲染期调整状态模式（不用 effect）。
  const [prevFilters, setPrevFilters] = useState(filters);
  if (filters !== prevFilters) {
    setPrevFilters(filters);
    setPage(1);
  }

  const statusLabel = (kind: ProjectStatus) =>
    t(
      kind === "backlog"
        ? "statusBacklog"
        : kind === "planned"
          ? "statusPlanned"
          : kind === "in_progress"
            ? "statusInProgress"
            : kind === "completed"
              ? "statusCompleted"
              : "statusCanceled",
    );

  const changeStatus = async (row: ProjectListRow, status: ProjectStatus) => {
    if (!canManage || status === row.status) return;
    try {
      const result =
        space.kind === "team"
          ? await updateTeamProjectStatusAction({ teamId: space.teamId, projectId: row.id, status })
          : await updatePersonalProjectStatusAction(row.id, status);
      if (!result.ok) {
        toast.error(result.errors.form ?? tErrors("operationFailed"));
        return;
      }
      router.refresh();
    } catch {
      toast.error(tErrors("operationFailed"));
    }
  };

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
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const priorityLabel = (priority: TaskPriority) =>
    t(priority === "high" ? "priorityHigh" : priority === "medium" ? "priorityMedium" : "priorityLow");

  // 团队 7 列（含负责人）；个人 6 列（负责人恒为自己，不展示）。
  const showLeadColumn = space.kind === "team";
  const columnCount = showLeadColumn ? 7 : 6;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
        {/* 状态筛选下拉（全部 + 五态；替换原 tabs）。 */}
        <Select
          value={filters.status}
          onValueChange={(next) =>
            setFilters((current) => ({
              ...current,
              status: next as ProjectListFilters["status"],
            }))
          }
        >
          <SelectTrigger className="w-[150px]" aria-label={t("colStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("statusFilterAll")}</SelectItem>
            {PROJECT_STATUSES.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {statusLabel(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
              <th className="px-3 py-2.5 text-left font-medium">{t("colProgress")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colPriority")}</th>
              {showLeadColumn ? (
                <th className="px-3 py-2.5 text-left font-medium">{t("colLead")}</th>
              ) : null}
              <th className="px-3 py-2.5 text-left font-medium">{t("colDueDate")}</th>
              <th className="px-3 py-2.5 text-left font-medium">{t("colTaskCount")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  data-testid="project-filter-empty"
                  className="px-4 py-10 text-center text-[var(--color-text-muted)]"
                >
                  {t("filterEmpty")}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => (
                <motion.tr
                  key={row.id}
                  data-testid="project-row"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest("a,button")) return;
                    setSelected(row);
                  }}
                  className="cursor-pointer border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--color-surface-hover)]"
                >
                  <td className="px-4 py-3" data-testid={`project-row-${index}`}>
                    <button
                      type="button"
                      className="block min-w-0 max-w-full cursor-pointer text-left"
                      onClick={() => setSelected(row)}
                    >
                      <span className="block truncate font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)]">
                        {row.name}
                      </span>
                      {(row.summary ?? row.description) ? (
                        <span className="mt-0.5 block truncate text-[12.5px] font-normal text-[var(--color-text-muted)]">
                          {row.summary ?? row.description}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-progress-bg)]">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${row.progressPercent}%`,
                            backgroundColor: progressFillVar[row.status],
                          }}
                        />
                      </span>
                      <span className="tabular-nums text-[var(--color-text-secondary)]">
                        {row.progressPercent}%
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityPillClass(row.priority)}`}
                    >
                      {priorityLabel(row.priority)}
                    </span>
                  </td>
                  {showLeadColumn ? (
                    <td className="px-3 py-3">
                      {row.lead ? (
                        <span className="flex items-center gap-1.5">
                          <UserAvatar userId={row.lead.id} name={row.lead.name} size={22} />
                          <span className="truncate text-[var(--color-text-secondary)]">
                            {row.lead.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">-</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">
                    {row.endDate ?? "-"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-[var(--color-text-secondary)]">
                    {row.taskCount}
                  </td>
                  <td className="px-4 py-3">
                    <ProjectStatusPill
                      status={row.status}
                      disabled={!canManage}
                      onChange={(status) => void changeStatus(row, status)}
                      onError={(message) => toast.error(message)}
                      testid={`project-status-pill-${row.id}`}
                    />
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 客户端分页：仅超过一页时显示（上一页/下一页 + 页码 + 总数）。 */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-3 text-[12.5px] text-[var(--color-text-muted)]">
          <span data-testid="project-page-info">
            {t("pageInfo", { page, total: totalPages, count: filtered.length })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("pagePrev")}
              data-testid="project-page-prev"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("pageNext")}
              data-testid="project-page-next"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      <ProjectDetailDrawer
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
        space={space}
        project={selected}
        canManage={canManage}
      />
    </div>
  );
}
