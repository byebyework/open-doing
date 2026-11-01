import { getTranslations } from "next-intl/server";

import type { TrendBucket } from "../buckets";

/**
 * 自绘图表（服务端可渲染，无 "use client"、不依赖任何图表库）。
 *
 * 结构与配色逐项对照 `docs/prototypes/space-analysis-{personal,team}.html`
 * 的 `.vz-*` / `.hbar-*` / `.week-bars` 区块；hover 说明走原生 `title`，
 * 不产生客户端 JS。
 */

/** 单条趋势系列的色相。 */
export interface TrendSeries {
  /** `primary` = 品牌紫 `#7d2ae8`；`teal` = 新增系列 `#0e9ba3`。 */
  tone: "primary" | "teal";
  /** 与 `TrendChartProps.buckets` 等长的计数数组。 */
  values: number[];
}

/** 系列色值（teal 不是主题令牌，只能是字面 hex；文字不穿系列色）。 */
const SERIES_COLOR: Record<TrendSeries["tone"], string> = {
  primary: "#7d2ae8",
  teal: "#0e9ba3",
};

/** 趋势柱状图入参。 */
export interface TrendChartProps {
  /** 分桶（7/30 天逐日、90 天按周、未来 14 天逐日）。 */
  buckets: TrendBucket[];
  /** 单系列 1 柱 / 双系列并排 2 柱；柱序即渲染顺序。 */
  series: TrendSeries[];
  /** 每个计数单位对应的像素高度，默认 36px。 */
  unit?: number;
  /** y 轴最大值；缺省取全部系列的最大值（全 0 时为 0，只画基线）。 */
  yMax?: number;
  /** 单系列悬停文案；默认 `完成 N`（未来截止分布可传 `N 项到期`）。 */
  formatValue?: (value: number) => string;
  /** 单系列 0 值悬停文案，默认「无完成」。 */
  emptyLabel?: string;
  /** 「今天」所在桶下标；悬停文案给该桶加「今天 」前缀（未来截止为首桶）。 */
  todayIndex?: number;
}

/**
 * 分组柱状图（完成趋势 / 吞吐 / 新增 vs 完成 / 未来截止分布）。
 *
 * - y 轴刻度：0..yMax；`yMax <= 3` 时每个整数一档，否则只画偶数档
 *   （与原型三张图的刻度密度一致）；
 * - 网格线为 hairline `#e1e3e6`，0 值基线用加强边 `#c7cdd3`；
 * - 0 值桶不画柱（列仍占位，保证 x 轴对齐）；
 * - 每系列峰值（并列取最后一根）与末桶直接标数；
 * - x 轴每 5 桶标一个标签，并始终标出末桶。
 */
export async function TrendChart({
  buckets,
  series,
  unit = 36,
  yMax,
  formatValue,
  emptyLabel,
  todayIndex,
}: TrendChartProps) {
  // 悬停说明的文案在组件内取词；emptyLabel 仍可由调用方覆盖（如「无」）。
  const t = await getTranslations("analysis");
  const resolvedEmpty = emptyLabel ?? t("chartEmpty");
  const valueLabel = (tone: TrendSeries["tone"], value: number) =>
    tone === "teal" ? t("chartCreatedValue", { value }) : t("chartDoneValue", { value });
  const allValues = series.flatMap((item) => item.values);
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
  const resolvedYMax = Math.max(yMax ?? maxValue, 0);
  const tickStep = resolvedYMax <= 3 ? 1 : 2;
  // 160 / 190 分别对应原型 yMax=3 / 4 的绘图区高度。
  const plotHeight = Math.max(160, resolvedYMax * unit + 46);

  const ticks: number[] = [];
  for (let value = 0; value <= resolvedYMax; value += tickStep) {
    ticks.push(value);
  }

  const peakIndexes = series.map((item) => lastPeakIndex(item.values));
  const lastIndex = buckets.length - 1;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 gap-1.5">
        {/* 左侧 y 轴刻度（右对齐，垂直居中对齐到网格线） */}
        <div
          className="relative w-[26px] flex-none"
          style={{ height: plotHeight }}
          aria-hidden="true"
        >
          {ticks.map((value) => (
            <span
              key={value}
              className="absolute right-0 text-[11px] text-[#5f6368]"
              style={{
                bottom: value * unit,
                transform: "translateY(50%)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </span>
          ))}
        </div>

        {/* 绘图区：网格 + 柱列 */}
        <div className="relative min-w-0 flex-1" style={{ height: plotHeight }}>
          <div className="absolute inset-0" aria-hidden="true">
            {ticks
              .filter((value) => value > 0)
              .map((value) => (
                <i
                  key={value}
                  className="absolute left-0 right-0 block h-px bg-[#e1e3e6]"
                  style={{ bottom: value * unit }}
                />
              ))}
            <i className="absolute bottom-0 left-0 right-0 block h-px bg-[#c7cdd3]" />
          </div>

          <div
            className="absolute inset-0 flex items-end gap-[3px]"
            style={{ paddingTop: 24 }}
          >
            {buckets.map((bucket, bucketIndex) => (
              <div
                key={`${bucket.start}-${bucket.label}-${bucketIndex}`}
                title={columnTitle(
                  bucketIndex === todayIndex
                    ? t("chartToday", { label: bucket.label })
                    : bucket.label,
                  series,
                  bucketIndex,
                  formatValue,
                  resolvedEmpty,
                  valueLabel,
                  t("chartUnchanged"),
                )}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]"
              >
                {series.map((item, seriesIndex) => {
                  const value = item.values[bucketIndex] ?? 0;
                  if (value <= 0) return null;

                  const labelled =
                    bucketIndex === peakIndexes[seriesIndex] ||
                    bucketIndex === lastIndex;

                  return (
                    <i
                      key={item.tone}
                      className="relative block flex-none"
                      style={{
                        width: 9,
                        height: Math.min(value, resolvedYMax) * unit,
                        borderRadius: "4px 4px 0 0",
                        background: SERIES_COLOR[item.tone],
                      }}
                    >
                      {labelled ? (
                        <em
                          className="absolute left-1/2 text-[11px] font-semibold not-italic text-[#3c4043]"
                          style={{ top: -19, transform: "translateX(-50%)" }}
                        >
                          {value}
                        </em>
                      ) : null}
                    </i>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* x 轴：左侧 32px 与 y 轴列（26px + 6px gap）对齐 */}
      <div className="mt-1.5 flex gap-[3px]">
        <span className="w-8 flex-none" aria-hidden="true" />
        {buckets.map((bucket, index) => (
          <span
            key={`${bucket.start}-${bucket.label}-${index}`}
            className="min-w-0 flex-1 whitespace-nowrap text-[11px] text-[#5f6368]"
            style={{
              textAlign: index === lastIndex ? "right" : "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {index % 5 === 0 || index === lastIndex ? bucket.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 并列最大值取最后一根（与原型「峰值 + 末桶」的标数位置一致）。 */
function lastPeakIndex(values: number[]): number {
  let peak = -1;
  let max = 0;

  for (let index = 0; index < values.length; index++) {
    const value = values[index] ?? 0;
    if (value > max) {
      max = value;
      peak = index;
    }
  }

  return peak;
}

/**
 * 柱列的原生悬停说明：单系列「MM-DD · 完成 N」，双系列「· 新增 N / 完成 N」。
 * 数值与「无变化」文案由调用方按当前语言传入。
 */
function columnTitle(
  label: string,
  series: TrendSeries[],
  index: number,
  formatValue: TrendChartProps["formatValue"],
  emptyLabel: string,
  valueLabel: (tone: TrendSeries["tone"], value: number) => string,
  unchangedLabel: string,
): string {
  if (series.length === 1) {
    const value = series[0]?.values[index] ?? 0;
    const text =
      value === 0 ? emptyLabel : formatValue ? formatValue(value) : valueLabel("primary", value);
    return `${label} · ${text}`;
  }

  const parts = series.flatMap((item) => {
    const value = item.values[index] ?? 0;
    if (value <= 0) return [];
    return [valueLabel(item.tone, value)];
  });

  return parts.length > 0 ? `${label} · ${parts.join(" / ")}` : `${label} · ${unchangedLabel}`;
}

/** 横向条列表的一行。 */
export interface HBarRow {
  /** React key。 */
  key: string;
  /** 主名（项目名 / 成员名）。 */
  name: string;
  /** 原生悬停文案；缺省为「名称 · 计数」，调用方可传原型口径的完整句式。 */
  title?: string;
  /** 次行说明（成员负载的逾期 / 临期注记）；提供时按双行布局渲染。 */
  sub?: string;
  /** 行内标签（如「团队」）。 */
  tag?: string;
  /** 当前计数。 */
  count: number;
  /** 归一化基准（列表内最大计数）。 */
  max: number;
}

/** 横向条列表：条高 14px、左端方角右端 4px 圆角，宽度 = count/max。 */
export function HBarList({ rows }: { rows: HBarRow[] }) {
  return (
    <div className="min-w-0">
      {rows.map((row, index) => {
        const percent =
          row.max > 0
            ? Math.min(100, Math.max(0, (row.count / row.max) * 100))
            : 0;

        return (
          <div
            key={row.key}
            title={
              row.title ??
              `${row.name}${row.tag ? ` · ${row.tag}` : ""} · ${row.count}`
            }
            className={`flex min-w-0 items-center gap-3 py-[13px] ${
              index > 0 ? "border-t border-[#e1e3e6]" : ""
            }`}
          >
            {row.sub !== undefined ? (
              <div className="w-24 flex-none leading-[1.3]">
                <div className="truncate text-[13.5px] font-semibold text-[#0e1318]">
                  {row.name}
                </div>
                <div className="truncate text-[12px] text-[#5f6368]">
                  {row.sub}
                </div>
              </div>
            ) : (
              <div className="w-[170px] flex-none truncate whitespace-nowrap text-[13.5px] font-semibold text-[#0e1318]">
                {row.name}
                {row.tag ? (
                  <span
                    className="ml-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 align-middle text-[12px] font-medium"
                    style={{
                      background: "rgba(155, 135, 245, 0.14)",
                      color: "#6d4fd4",
                    }}
                  >
                    {row.tag}
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2">
              {percent > 0 ? (
                <div
                  style={{
                    width: `${percent}%`,
                    height: 14,
                    minWidth: 2,
                    background: "#7d2ae8",
                    borderRadius: "0 4px 4px 0",
                  }}
                />
              ) : null}
              <b
                className="flex-none text-[12.5px] font-semibold text-[#3c4043]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {row.count}
              </b>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 6 根 6px 宽迷你柱：高 = 值 × 4px，0 值跳过。 */
export function WeekMiniBars({
  values,
  title,
}: {
  values: number[];
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-end gap-[3px]"
      style={{ height: 14 }}
      title={title}
    >
      {values.map((value, index) =>
        value > 0 ? (
          <i
            key={index}
            className="inline-block"
            style={{
              width: 6,
              height: value * 4,
              background: "#7d2ae8",
              borderRadius: "2px 2px 0 0",
              opacity: 0.85,
            }}
          />
        ) : null,
      )}
    </span>
  );
}
