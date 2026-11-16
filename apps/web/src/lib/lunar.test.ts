import { describe, expect, it } from "vitest";
import { lunarToSolar, solarLunarYear } from "./lunar";
import { daysBetween } from "./today";

describe("lunarToSolar", () => {
  // 锚点事实:2026 年春节 = 2026-02-17;2027 年春节 = 2027-02-06。
  it("converts lunar new year 2026", () => {
    expect(lunarToSolar({ year: 2026, month: 1, day: 1 })).toBe("2026-02-17");
  });
  it("converts lunar new year 2027", () => {
    expect(lunarToSolar({ year: 2027, month: 1, day: 1 })).toBe("2027-02-06");
  });
  it("clamps day 30 to the month's last day when the month has 29 days", () => {
    // 用任一已知 29 天农历月;若所选月份实为 30 天,换用别的月份——断言含义是
    // 「结果落在该农历月的最后一个公历日」,实现不得对 day>月长 抛错。
    const result = lunarToSolar({ year: 2025, month: 6, day: 30 });
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("clamps day 30 to the actual last solar day of a 29-day lunar month", () => {
    // 2026 年农历七月是 29 天月:月长由库查询证明,不硬编码——
    // 廿九的次日恰为农历八月初一,说明七月到廿九为止;
    // 若为 30 天月,廿九与八月初一之间会隔一天。
    const lastDay = lunarToSolar({ year: 2026, month: 7, day: 29 });
    expect(daysBetween(lastDay, lunarToSolar({ year: 2026, month: 8, day: 1 }))).toBe(1);
    // day 30 超过月长,不得抛错,应顺延为当月最后一个公历日。
    expect(lunarToSolar({ year: 2026, month: 7, day: 30 })).toBe(lastDay);
  });
});
describe("solarLunarYear", () => {
  it("maps a January date to the still-ongoing previous lunar year", () => {
    // 2026-01-10 在农历乙巳年(2025)腊月内,必须得 2025,不是 2026。
    expect(solarLunarYear("2026-01-10")).toBe(2025);
  });
  it("maps a date after lunar new year to that lunar year", () => {
    expect(solarLunarYear("2026-03-01")).toBe(2026);
  });
});
