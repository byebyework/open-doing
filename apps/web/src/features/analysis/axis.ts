/** 图表 x 轴标签密度：wide = 全宽卡片、narrow = 半宽卡片（grid-cols-2 的一半）。 */
export type AxisDensity = "wide" | "narrow";

/**
 * x 轴标注的桶下标：i % (wide?5:10) === 0，外加末桶恒标（末桶重复时只出现一次）。
 */
export function xTickIndexes(count: number, density: AxisDensity): number[] {
  const indexes: number[] = [];
  if (count <= 0) return indexes;

  const step = density === "narrow" ? 10 : 5;
  for (let index = 0; index < count; index += step) {
    indexes.push(index);
  }

  const last = count - 1;
  if (indexes[indexes.length - 1] !== last) {
    indexes.push(last);
  }
  return indexes;
}

/** tick 显示文案：首桶与末桶完整 YYYY-MM-DD，中间取 MM-DD（label.slice(5)）。 */
export function tickDisplayLabel(label: string, index: number, count: number): string {
  return index === 0 || index === count - 1 ? label : label.slice(5);
}
