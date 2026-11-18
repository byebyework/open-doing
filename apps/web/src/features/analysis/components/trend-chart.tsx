"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/shadcn/chart";

import { tickDisplayLabel, xTickIndexes } from "../axis";
import { columnTitle, type TrendSeries } from "../chart-title";
import type { TrendBucket } from "../buckets";

/**
 * 趋势柱状图（recharts 版，客户端）。
 *
 * 分桶、悬停文案、峰值/末桶标数、x 轴标签密度沿用原有语义；视觉遵循
 * shadcn 图表惯例 + 设计系统（2026-11-18 重设计）：
 * - 系列色全 token：`created` → `--cyan-500`（品牌渐变第二色），
 *   `primary` → `--purple-600`；由 ChartContainer 的 ChartStyle 按
 *   config key 注入 `--color-*`，柱形填充引用注入变量（dataviz 校验器
 *   对双系列对全项 PASS，cyan 的低对比由峰值/末桶直接标数救济）；
 * - 柱宽跟随槽位（barCategoryGap 20%、maxBarSize 28），相邻柱 2px 表面
 *   间隙；顶部两角 4px 圆角锚定基线；
 * - 悬停层：shadcn ChartTooltip（设计化 tooltip + 系列色光标）叠加在
 *   原生 `title` 之上——后者为 e2e 断言保留（字节级文案不变）。
 *
 * 绘图区固定 260px 高（并排卡片行高恒定）。
 */

/** 系列色值：走 ChartContainer 按 config key 注入的 `--color-*` 变量。 */
const SERIES_FILL: Record<TrendSeries["tone"], string> = {
  primary: "var(--color-primary)",
  created: "var(--color-created)",
};

/** 峰值 / 末桶标数的字色（既有非令牌字面值，按原型沿用）。 */
const LABEL_COLOR = "#3c4043";

/** 固定绘图区高度（px）。 */
const PLOT_HEIGHT = 260;

/** 趋势柱状图入参。 */
export interface TrendChartProps {
  /** 分桶（7/30 天逐日、90 天按周、未来 14 天逐日）。 */
  buckets: TrendBucket[];
  /** 单系列 1 柱 / 双系列并排 2 柱；柱序即渲染顺序。 */
  series: TrendSeries[];
  /** 「今天」所在桶下标；悬停文案给该桶加「今天 」前缀（未来截止为首桶）。 */
  todayIndex?: number;
  /** x 轴标签密度：wide = 全宽卡（每 5 桶）、narrow = 半宽卡（每 10 桶防溢出）；缺省 wide。 */
  axisDensity?: "wide" | "narrow";
  /** 单系列非 0 文案模板（含 `{value}`），覆盖默认「完成 {value}」。 */
  valueTemplate?: string;
  /** 单系列 0 值文案；缺省「无完成」。 */
  emptyLabel?: string;
}

/** recharts 自定义柱形接收的几何属性（内部只用到这几项）。 */
interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  /** 数据行下标（Bar 渲染时注入）。 */
  index?: number;
}

/** 柱形数据行：桶标签 + 每系列一个数值字段，供 recharts 按 dataKey 取值。 */
type ChartRow = { label: string } & Record<string, string | number>;

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

/** 顶部两角 4px 圆角的柱形路径（底部保持方角，对齐原型 `radius: 4px 4px 0 0`）。 */
function roundedTopBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const radius = Math.min(4, width / 2, height);

  return [
    `M${x},${y + height}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + width - radius},${y}`,
    `Q${x + width},${y} ${x + width},${y + radius}`,
    `L${x + width},${y + height}`,
    "Z",
  ].join(" ");
}

/**
 * 分组柱状图（完成趋势 / 吞吐 / 新增 vs 完成 / 未来截止分布）。
 *
 * - 0 值桶照常渲染（recharts 高度为 0）；
 * - 每系列峰值（并列取最后）与末桶直接标数；
 * - 悬停 `title` 挂在自定义柱形上（原生 tooltip，无额外 JS）。
 */
export function TrendChart({
  buckets,
  series,
  todayIndex,
  axisDensity = "wide",
  valueTemplate,
  emptyLabel,
}: TrendChartProps): React.ReactNode {
  const t = useTranslations("analysis");

  const doneTemplate = t("chartDoneValue", { value: "{value}" });
  const createdTemplate = t("chartCreatedValue", { value: "{value}" });
  const unchangedLabel = t("chartUnchanged");
  const resolvedEmpty = emptyLabel ?? t("chartEmpty");

  const maxValue =
    series.length > 0
      ? Math.max(0, ...series.flatMap((item) => item.values))
      : 0;
  const yStep = maxValue <= 3 ? 1 : 2;
  const yTicks: number[] = [];
  for (let value = 0; value <= maxValue; value += yStep) {
    yTicks.push(value);
  }

  const chartData: ChartRow[] = buckets.map((bucket, index) => {
    const row: ChartRow = { label: bucket.label };
    series.forEach((item, seriesIndex) => {
      row[`series${seriesIndex}`] = item.values[index] ?? 0;
    });
    return row;
  });

  const labelIndex = new Map(
    buckets.map((bucket, index) => [bucket.label, index] as const),
  );
  const xTicks = xTickIndexes(buckets.length, axisDensity).map(
    (index) => buckets[index].label,
  );
  const formatTick = (label: string) =>
    tickDisplayLabel(
      label,
      labelIndex.get(label) ?? 0,
      buckets.length,
    );

  const titleForBucket = (index: number) =>
    columnTitle({
      bucketLabel:
        index === todayIndex
          ? t("chartToday", { label: buckets[index].label })
          : buckets[index].label,
      isToday: false,
      todayPrefix: "",
      series,
      index,
      singleValueTemplate: series.length === 1 ? valueTemplate : undefined,
      emptyLabel: resolvedEmpty,
      doneTemplate,
      createdTemplate,
      unchangedLabel,
    });

  const lastBucketIndex = buckets.length - 1;

  return (
    <ChartContainer
      config={{
        primary: { color: "var(--purple-600)" },
        created: { color: "var(--cyan-500)" },
      }}
      style={{ height: PLOT_HEIGHT }}
      className="w-full min-w-0"
    >
      <BarChart
        data={chartData}
        margin={{ top: 24, right: 4, left: 0, bottom: 0 }}
        barCategoryGap="20%"
        barGap={2}
      >
        <CartesianGrid vertical={false} stroke="var(--border-default)" />
        <ChartTooltip
          cursor={{ fill: "var(--purple-08)" }}
          content={<ChartTooltipContent />}
        />
        <YAxis
          width={26}
          axisLine={false}
          tickLine={false}
          domain={[0, maxValue === 0 ? 1 : maxValue]}
          ticks={yTicks}
          allowDecimals={false}
          tick={{
            fontSize: 11,
            fill: "var(--ink-500)",
            style: { fontVariantNumeric: "tabular-nums" },
          }}
        />
        <XAxis
          dataKey="label"
          ticks={xTicks}
          tickFormatter={formatTick}
          tickLine={false}
          axisLine={{ stroke: "#c7cdd3" }}
          tick={{
            fontSize: 11,
            fill: "var(--ink-500)",
            style: { fontVariantNumeric: "tabular-nums" },
          }}
        />
        {series.map((item, seriesIndex) => {
          const dataKey = `series${seriesIndex}`;
          const peakIndex = lastPeakIndex(item.values);

          return (
            <Bar
              key={`${item.tone}-${seriesIndex}`}
              dataKey={dataKey}
              fill={SERIES_FILL[item.tone]}
              maxBarSize={28}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              shape={(shapeProps: unknown) => {
                const bar = shapeProps as BarShapeProps;
                // recharts 的 ActiveShape 形参类型是 unknown；几何属性由
                // BarRectangle 注入（x/y/width/height/index/fill）。
                const titleProps = {
                  title: titleForBucket(bar.index ?? 0),
                } as React.SVGProps<SVGPathElement>;

                return (
                  <path
                    d={roundedTopBarPath(
                      bar.x ?? 0,
                      bar.y ?? 0,
                      bar.width ?? 0,
                      bar.height ?? 0,
                    )}
                    fill={bar.fill}
                    {...titleProps}
                  />
                );
              }}
            >
              <LabelList
                dataKey={dataKey}
                content={(props) => {
                  const labelProps = props as unknown as {
                    value?: number;
                    index?: number;
                    viewBox?: { x: number; y: number; width: number };
                  };
                  const value = labelProps.value ?? 0;
                  const index = labelProps.index ?? -1;
                  const viewBox = labelProps.viewBox;

                  if (
                    value <= 0 ||
                    viewBox === undefined ||
                    (index !== peakIndex && index !== lastBucketIndex)
                  ) {
                    return null;
                  }

                  return (
                    <text
                      x={viewBox.x + viewBox.width / 2}
                      y={viewBox.y - 6}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={LABEL_COLOR}
                    >
                      {value}
                    </text>
                  );
                }}
              />
            </Bar>
          );
        })}
      </BarChart>
    </ChartContainer>
  );
}
