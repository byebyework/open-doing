"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import type { AnalysisRange } from "../buckets";

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
  const t = useTranslations("analysis");

  // 文案与顺序对照原型 `.seg`。
  const rangeOptions: { value: AnalysisRange; label: string }[] = [
    { value: 7, label: t("rangeDays", { range: 7 }) },
    { value: 30, label: t("rangeDays", { range: 30 }) },
    { value: 90, label: t("rangeDays", { range: 90 }) },
  ];

  return (
    <div
      role="group"
      aria-label={t("rangeGroupAria")}
      className="inline-flex items-center gap-[2px] rounded-lg p-[3px]"
      style={{ background: "#e8eaed" }}
    >
      {rangeOptions.map((option) => {
        const active = option.value === range;

        return (
          <button
            key={option.value}
            type="button"
            data-testid={`analysis-range-${option.value}`}
            aria-pressed={active}
            onClick={() => router.push(`${basePath}?range=${option.value}`)}
            className={`cursor-pointer rounded-md px-3.5 py-[5px] text-[13px] font-semibold transition-colors ${
              active
                ? "bg-white text-[var(--ink-900)] shadow-[var(--shadow-rest)]"
                : "text-[var(--ink-500)] hover:text-[var(--ink-900)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
