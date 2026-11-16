import { describe, expect, it } from "vitest";

import { resolveOccurrence } from "./important-days";

/** stub 换算器：直接把农历年月日拼成 `YYYY-MM-DD`，保持测试纯函数确定性。 */
const stub = (l: { year: number; month: number; day: number }) =>
  `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}`;

describe("resolveOccurrence", () => {
  it("elapsed: past non-repeat date counts up", () => {
    expect(resolveOccurrence({ date: "2020-03-01", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "none" }, "2026-11-16"))
      .toEqual({ direction: "elapsed", date: "2020-03-01", days: 2451 });
  });
  it("upcoming: future non-repeat date counts down", () => {
    expect(resolveOccurrence({ date: "2027-03-01", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "none" }, "2026-11-16"))
      .toEqual({ direction: "upcoming", date: "2027-03-01", days: 105 });
  });
  it("today boundary: days is 0", () => {
    expect(resolveOccurrence({ date: "2026-11-16", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "none" }, "2026-11-16").days).toBe(0);
  });
  it("yearly solar rolls to next year when this year's passed", () => {
    expect(resolveOccurrence({ date: "1990-10-01", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "yearly" }, "2026-11-16").date)
      .toBe("2027-10-01");
  });
  it("yearly solar Feb 29 coalesces to Feb 28 in non-leap years", () => {
    expect(resolveOccurrence({ date: "2000-02-29", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "yearly" }, "2026-01-31").date)
      .toBe("2026-02-28");
  });
  it("yearly lunar anchors to the lunar year today belongs to, not the Gregorian year", () => {
    // today=2026-01-10 属农历 2025；候选 = 农历 2025 的 (12,20)=2025-12-20(已过)与
    // 农历 2026 的 (12,20)=2026-12-20，取 ≥ today 最近者 → 后者。
    expect(resolveOccurrence({ date: null, isLunar: true, lunarMonth: 12, lunarDay: 20, repeat: "yearly" }, "2026-01-10", stub))
      .toEqual({ direction: "upcoming", date: "2026-12-20", days: 344 });
  });
  it("yearly lunar integrates with the real converter across the Dec-Feb boundary", () => {
    // 真库用例：农历十二月生日在公历 1 月观察，不得算偏一年。
    const r = resolveOccurrence({ date: null, isLunar: true, lunarMonth: 1, lunarDay: 1, repeat: "yearly" }, "2026-01-10");
    expect(r.date).toBe("2026-02-17"); // 下一农历年（丙午）正月初一 = 2026-02-17
  });
});
