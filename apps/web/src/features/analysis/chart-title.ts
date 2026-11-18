/**
 * 趋势柱列悬停文案构建器 —— 旧 charts.tsx `columnTitle` 的纯函数化
 * （输出文案逐字不变），供 recharts 版图表复用。
 */

/** 单条趋势系列的色相。 */
export interface TrendSeries {
  /** `primary` = 品牌紫；`teal` = 新增系列。 */
  tone: "primary" | "teal";
  /** 与桶序列等长的计数数组。 */
  values: number[];
}

/**
 * 柱列的悬停说明：
 * - 单系列「YYYY-MM-DD · 完成 N」；0 值用 `emptyLabel`（如「无」）；
 *   单系列非 0 模板取 `singleValueTemplate`（缺省 `doneTemplate`），
 *   把 `{value}` 占位替换成数值；
 * - 双系列只列有值的系列，按入参顺序 join(" / ")（如「新增 N / 完成 N」）；
 *   全 0 用 `unchangedLabel`（「无变化」）；
 * - `isToday` 时桶标签加「今天 」前缀（`todayPrefix`）。
 *
 * 文案（模板 / 标签）全部由调用方按当前语言传入，本函数不做 i18n。
 */
export function columnTitle(input: {
  /** 桶标签（YYYY-MM-DD）。 */
  bucketLabel: string;
  /** 是否「今天」所在桶；是则用 `todayPrefix + " " + bucketLabel` 作前缀。 */
  isToday: boolean;
  /** 「今天」文案前缀（zh「今天」/ en "Today"）。 */
  todayPrefix: string;
  /** 系列列表；长度 1 走单系列句式，长度 >= 2 走双系列句式。 */
  series: TrendSeries[];
  /** 桶下标。 */
  index: number;
  /** 单系列非 0 文案模板，含 {value}；缺省用 doneTemplate。 */
  singleValueTemplate?: string;
  /** 单系列 0 值文案（如「无」）；由调用方保证提供。 */
  emptyLabel?: string;
  /** 主系列数值模板（zh「完成 {value}」）。 */
  doneTemplate: string;
  /** 新增系列数值模板（zh「新增 {value}」）。 */
  createdTemplate: string;
  /** 双系列全 0 文案（zh「无变化」）。 */
  unchangedLabel: string;
}): string {
  const label = input.isToday
    ? `${input.todayPrefix} ${input.bucketLabel}`
    : input.bucketLabel;

  if (input.series.length === 1) {
    const value = input.series[0]?.values[input.index] ?? 0;
    if (value === 0) {
      return `${label} · ${input.emptyLabel ?? ""}`;
    }
    const template = input.singleValueTemplate ?? input.doneTemplate;
    return `${label} · ${template.replace("{value}", String(value))}`;
  }

  const parts = input.series.flatMap((item) => {
    const value = item.values[input.index] ?? 0;
    if (value <= 0) return [];
    const template =
      item.tone === "teal" ? input.createdTemplate : input.doneTemplate;
    return [template.replace("{value}", String(value))];
  });

  return parts.length > 0
    ? `${label} · ${parts.join(" / ")}`
    : `${label} · ${input.unchangedLabel}`;
}
