/** 图表 x 轴标签密度：wide = 全宽卡片、narrow = 半宽卡片（grid-cols-2 的一半）。 */
export type AxisDensity = "wide" | "narrow";

/** x 轴标签步长（每 N 桶标一个；末桶始终标注，由渲染层保证）。 */
export function axisLabelStep(density: AxisDensity): number {
  return density === "narrow" ? 10 : 5;
}
