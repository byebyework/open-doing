import { expect, it } from "vitest";
import { resolveOccurrence } from "./moment-occurrence";

const rule = (r: Partial<Parameters<typeof resolveOccurrence>[0]> = {}) => ({
  mode: "countdown", anchorDate: "2027-03-01", cycle: null, weekday: null, dayOfMonth: null, ...r,
} as Parameters<typeof resolveOccurrence>[0]);

it("countdown future counts down", () => {
  expect(resolveOccurrence(rule(), "2026-11-17")).toEqual({ direction: "upcoming", date: "2027-03-01", days: 104 });
});
it("countdown flips to elapsed with positive days after the target", () => {
  expect(resolveOccurrence(rule({ anchorDate: "2026-01-01" }), "2026-11-17"))
    .toEqual({ direction: "elapsed", date: "2026-01-01", days: 320 });
});
it("countdown on the target day is today", () => {
  expect(resolveOccurrence(rule({ anchorDate: "2026-11-17" }), "2026-11-17").direction).toBe("today");
});
it("count_up counts elapsed; future anchor is clamped to today (service rejects the input)", () => {
  expect(resolveOccurrence(rule({ mode: "count_up", anchorDate: "2025-09-15" }), "2026-11-17"))
    .toEqual({ direction: "elapsed", date: "2025-09-15", days: 428 });
  expect(resolveOccurrence(rule({ mode: "count_up", anchorDate: "2027-01-01" }), "2026-11-17"))
    .toEqual({ direction: "today", date: "2026-11-17", days: 0 });
});
it("periodic daily is always today", () => {
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-01", cycle: "daily" }), "2026-11-17"))
    .toEqual({ direction: "today", date: "2026-11-17", days: 0 });
});
it("weekly: next occurrence of the target weekday; same day = today", () => {
  // 2026-11-17 是周二(weekday=2)
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-01", cycle: "weekly", weekday: 5 }), "2026-11-17"))
    .toEqual({ direction: "upcoming", date: "2026-11-20", days: 3 }); // 周五
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-01", cycle: "weekly", weekday: 2 }), "2026-11-17").direction)
    .toBe("today");
  // 周界:今天周六(6),目标周日(0) → 明天
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-01", cycle: "weekly", weekday: 0 }), "2026-11-21"))
    .toEqual({ direction: "upcoming", date: "2026-11-22", days: 1 });
});
it("monthly: day 31 clamps to month end in short months; rolls to next month when passed", () => {
  // 今天 2026-11-17;目标 31 号 → 11 月只有 30 天 → 2026-11-30
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-31", cycle: "monthly", dayOfMonth: 31 }), "2026-11-17"))
    .toEqual({ direction: "upcoming", date: "2026-11-30", days: 13 });
  // 11 月 30 日(钳制后的当天)= today;次日才滚动 → 12 月 31 日
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-31", cycle: "monthly", dayOfMonth: 31 }), "2026-11-30").direction)
    .toBe("today");
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-01-31", cycle: "monthly", dayOfMonth: 31 }), "2026-12-01").date)
    .toBe("2026-12-31");
  // 3/31 在 4 月(30 天)顺延为 4/30(判别性突变锚:错误实现给出 5/1 或 4/31 都会 FAIL)
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2020-03-31", cycle: "monthly", dayOfMonth: 31 }), "2026-04-01").date)
    .toBe("2026-04-30");
});
it("yearly: same month/day rolls to next year; Feb 29 coalesces to Feb 28", () => {
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2024-12-30", cycle: "yearly" }), "2026-11-17"))
    .toEqual({ direction: "upcoming", date: "2026-12-30", days: 43 });
  expect(resolveOccurrence(rule({ mode: "periodic", anchorDate: "2000-02-29", cycle: "yearly" }), "2026-01-31").date)
    .toBe("2026-02-28");
});
