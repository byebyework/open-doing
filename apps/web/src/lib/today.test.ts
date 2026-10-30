import { describe, expect, it } from "vitest";

import { daysBetween, getMonthEnd, getMonthGrid, weekdayLabel } from "./today";

describe("weekdayLabel", () => {
  it.each([
    ["2026-10-21", "周三"],
    ["2026-10-25", "周日"],
    ["2026-10-26", "周一"],
    ["2026-10-31", "周六"],
  ])("%s → %s", (date, label) => {
    expect(weekdayLabel(date)).toBe(label);
  });
});

describe("getMonthGrid", () => {
  it("2026-10 → 2026-09-28 ~ 2026-11-08（10-01 是周四，6 周网格）", () => {
    expect(getMonthGrid("2026-10")).toEqual({ start: "2026-09-28", end: "2026-11-08" });
  });
  it("2027-02 → 2027-02-01 ~ 2027-03-14（2-01 恰为周一）", () => {
    expect(getMonthGrid("2027-02")).toEqual({ start: "2027-02-01", end: "2027-03-14" });
  });
});
describe("getMonthEnd", () => {
  it("2026-10 → 2026-10-31; 2026-02 → 2026-02-28", () => {
    expect(getMonthEnd("2026-10")).toBe("2026-10-31");
    expect(getMonthEnd("2026-02")).toBe("2026-02-28");
  });
});
describe("daysBetween", () => {
  it("同日为 0；未来为正；过去为负；跨月正确", () => {
    expect(daysBetween("2026-10-21", "2026-10-21")).toBe(0);
    expect(daysBetween("2026-10-21", "2026-10-26")).toBe(5);
    expect(daysBetween("2026-10-21", "2026-10-19")).toBe(-2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});
