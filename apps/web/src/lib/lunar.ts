import { Lunar, LunarMonth } from "lunar-typescript";

/** 农历年月日;month 取值 1-12(闰月按平月过,spec 决策 4)。 */
export interface LunarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * 农历年月日 → 公历 `YYYY-MM-DD`。
 *
 * day 超过该农历月实际天数时顺延为当月最后一天(spec 决策 5):
 * 月长(29/30 天)由库查询,不硬编码;例如 30 日落在 29 天月时取廿九。
 *
 * 这是全项目唯一直接使用 `lunar-typescript` 的文件;其他模块须经此封装换算,
 * 避免第三方类型泄漏到业务层。
 */
export function lunarToSolar(lunar: LunarDate): string {
  const month = LunarMonth.fromYm(lunar.year, lunar.month);
  const day = month === null ? lunar.day : Math.min(lunar.day, month.getDayCount());

  return Lunar.fromYmd(lunar.year, lunar.month, day).getSolar().toYmd();
}

/**
 * 公历 `YYYY-MM-DD` → 其所属农历年号（跨农历新年边界由库裁定）。
 *
 * 入参按 UTC 正午解析为 Date,避免 UTC 午夜在负时区下落到前一天;
 * 例如 2026-01-10 尚在农历乙巳年(2025)腊月内,返回 2025 而非 2026。
 */
export function solarLunarYear(solar: string): number {
  const [year, month, day] = solar.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));

  return Lunar.fromDate(date).getYear();
}
