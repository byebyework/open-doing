import { describe, expect, it } from "vitest";

import { compareByPriority, type PrioritySortInput } from "./task-sort";

function row(overrides: Partial<PrioritySortInput>): PrioritySortInput {
  return {
    priority: "medium",
    dueDate: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("compareByPriority", () => {
  it("优先级高在前：high < medium < low（升序结果为 high→low）", () => {
    const rows = [
      row({ priority: "low" }),
      row({ priority: "high" }),
      row({ priority: "medium" }),
    ];
    const sorted = [...rows].sort(compareByPriority);

    expect(sorted.map((r) => r.priority)).toEqual(["high", "medium", "low"]);
  });

  it("同优先级按截止日期升序", () => {
    const sorted = [
      row({ dueDate: "2026-10-30" }),
      row({ dueDate: "2026-10-22" }),
    ].sort(compareByPriority);

    expect(sorted.map((r) => r.dueDate)).toEqual(["2026-10-22", "2026-10-30"]);
  });

  it("无截止日期排在同优先级有日期之后", () => {
    const sorted = [
      row({ dueDate: null }),
      row({ dueDate: "2026-12-31" }),
    ].sort(compareByPriority);

    expect(sorted.map((r) => r.dueDate)).toEqual(["2026-12-31", null]);
  });

  it("优先级与截止日期都相同时按创建时间升序（稳定尾序）", () => {
    const sorted = [
      row({ createdAt: "2026-10-05T00:00:00.000Z" }),
      row({ createdAt: "2026-10-02T00:00:00.000Z" }),
    ].sort(compareByPriority);

    expect(sorted.map((r) => r.createdAt)).toEqual([
      "2026-10-02T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    ]);
  });
});
