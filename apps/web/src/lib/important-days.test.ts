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
  it("today boundary: days is 0 and direction upcoming", () => {
    expect(resolveOccurrence({ date: "2026-11-16", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "none" }, "2026-11-16"))
      .toEqual({ direction: "upcoming", date: "2026-11-16", days: 0 });
  });
  it("yearly occurrence exactly today: days is 0 and direction upcoming", () => {
    expect(resolveOccurrence({ date: "2000-03-01", isLunar: false, lunarMonth: null, lunarDay: null, repeat: "yearly" }, "2026-03-01"))
      .toEqual({ direction: "upcoming", date: "2026-03-01", days: 0 });
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
    // 本例只验证「候选选取」机制：stub 把农历年直接当作公历年拼字符串，
    // 无法区分「今天所属农历年」与「公历年号」——该不变式由下方真库用例负责。
    // today=2026-01-10；候选 = stub 农历 2025 的 (12,20)=2025-12-20(已过)与
    // stub 农历 2026 的 (12,20)=2026-12-20，取 ≥ today 最近者 → 后者。
    expect(resolveOccurrence({ date: null, isLunar: true, lunarMonth: 12, lunarDay: 20, repeat: "yearly" }, "2026-01-10", stub))
      .toEqual({ direction: "upcoming", date: "2026-12-20", days: 344 });
  });
  it("yearly lunar anchors to the lunar year today belongs to (real converter, Dec-Feb boundary)", () => {
    // 真库用例，锁定农历年锚定不变式：today=2026-01-10 属农历 2025，腊月二十 = 2026-02-07。
    // 若错误地用公历年号 2026 生成候选，会得到农历 2026 腊月二十 = 2027-01-27，本用例必须失败。
    expect(resolveOccurrence({ date: null, isLunar: true, lunarMonth: 12, lunarDay: 20, repeat: "yearly" }, "2026-01-10"))
      .toEqual({ direction: "upcoming", date: "2026-02-07", days: 28 });
  });
});
