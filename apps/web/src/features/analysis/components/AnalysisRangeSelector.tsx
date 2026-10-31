"use client";

import { useRouter } from "next/navigation";

import type { AnalysisRange } from "../buckets";

/** 三个时间范围按钮（文案与顺序对照原型 `.seg`）。 */
const RANGE_OPTIONS: { value: AnalysisRange; label: string }[] = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
];

/** 分析页时间范围切换器入参。 */
export interface AnalysisRangeSelectorProps {
  /** 模块根路径（`moduleHref(spaceRef, "analysis")`）。 */
  basePath: string;
  /** 当前范围，用于高亮 active 按钮。 */
  range: AnalysisRange;
}

/**
 * 分析页时间范围切换器。
 *
 * 与原型 `.seg` 同构的普通按钮组（不引 antd Segmented，避免加重客户端包）；
 * 点击写回 URL（`?range=7|30|90`），由 RSC 重新取数。
 */
export function AnalysisRangeSelector({
  basePath,
  range,
}: AnalysisRangeSelectorProps) {
  const router = useRouter();

  return (
    <div
      role="group"
      aria-label="时间范围"
      className="inline-flex items-center gap-[2px] rounded-lg p-[3px]"
      style={{ background: "#e8eaed" }}
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.value === range;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => router.push(`${basePath}?range=${option.value}`)}
            className={`cursor-pointer rounded-md px-3.5 py-[5px] text-[13px] font-semibold transition-colors ${
              active
                ? "bg-white text-[#0e1318] shadow-[0_1px_3px_rgba(14,19,24,0.04)]"
                : "text-[#5f6368] hover:text-[#0e1318]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
