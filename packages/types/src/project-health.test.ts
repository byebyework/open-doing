import { describe, expect, it } from "vitest";

import { averageProjectProgress, getProjectHealthKind } from "./project-health";

describe("getProjectHealthKind", () => {
  it("逾期优先级最高:0% 但有逾期任务仍判逾期(而非未开始)", () => {
    expect(
      getProjectHealthKind({
        progress: 0,
        taskCount: 2,
        doneCount: 0,
        overdueCount: 1,
        dueSoonCount: 0,
      }),
    ).toBe("overdue");
  });

  it("无逾期但有临期任务判临期", () => {
    expect(
      getProjectHealthKind({
        progress: 0.5,
        taskCount: 4,
        doneCount: 2,
        overdueCount: 0,
        dueSoonCount: 2,
      }),
    ).toBe("dueSoon");
  });

  it("无逾期无临期且进度为 0 判未开始", () => {
    expect(
      getProjectHealthKind({
        progress: 0,
        taskCount: 6,
        doneCount: 0,
        overdueCount: 0,
        dueSoonCount: 0,
      }),
    ).toBe("notStarted");
  });

  it("其余情况判正常", () => {
    expect(
      getProjectHealthKind({
        progress: 0.48,
        taskCount: 25,
        doneCount: 12,
        overdueCount: 0,
        dueSoonCount: 0,
      }),
    ).toBe("normal");
  });
});

describe("averageProjectProgress", () => {
  it("空数组返回 0(无项目 = 0%)", () => {
    expect(averageProjectProgress([])).toBe(0);
  });

  it("各项目进度等权平均", () => {
    expect(averageProjectProgress([0.48, 0.62, 0.35])).toBeCloseTo(0.483333, 5);
  });

  it("空项目以 0 计入平均,不被排除", () => {
    expect(averageProjectProgress([0.5, 0])).toBe(0.25);
  });
});
