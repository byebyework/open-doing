import type { TagStatsRow } from "../service";
import { TagPill } from "@/features/tags/components/TagPill";

/** TagStatsBars 入参：聚合好的标签统计行（服务端算好，纯展示）。 */
export interface TagStatsBarsProps {
  rows: TagStatsRow[];
  /** 无标签数据时的空态文案。 */
  emptyText: string;
  /** 「完成 / 进行中」标签文案。 */
  doneLabel: string;
  openLabel: string;
}

/**
 * 标签维度横向条形图（spec §6.4）：每行 pill + 完成数条形 + openCount 文本。
 * 纯展示 RSC 组件；条形宽度以 doneCount 最大值为基准，多标签任务在各行各计一次。
 */
export function TagStatsBars({ rows, emptyText, doneLabel, openLabel }: TagStatsBarsProps) {
  if (rows.length === 0) {
    return <p className="py-3 text-[13px] text-[var(--ink-500)]">{emptyText}</p>;
  }

  const max = Math.max(1, ...rows.map((row) => row.doneCount));

  return (
    <div className="mt-3">
      {rows.map((row) => (
        <div
          key={row.tagId}
          className="flex min-w-0 items-center gap-3 border-t border-[var(--border-default)] py-2.5 first:border-t-0"
        >
          <span className="min-w-0 flex-1">
            <TagPill name={row.tagName} color={row.color} />
          </span>
          <span
            className="h-1.5 shrink-0 overflow-hidden rounded-full bg-[var(--purple-100)]"
            style={{ width: 160 }}
            role="img"
            aria-label={`${row.tagName} ${doneLabel} ${row.doneCount}`}
          >
            <span
              className="block h-full rounded-full bg-[var(--purple-600)]"
              style={{ width: `${Math.round((row.doneCount / max) * 100)}%` }}
            />
          </span>
          <span className="w-28 shrink-0 text-right text-[12px] tabular-nums text-[var(--muted-foreground)]">
            {doneLabel} {row.doneCount} · {openLabel} {row.openCount}
          </span>
        </div>
      ))}
    </div>
  );
}
