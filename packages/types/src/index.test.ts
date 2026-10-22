// @ts-nocheck —— Task 1 阶段尚未安装 vitest（Task 2 统一安装）；安装后可移除本行。
import { describe, expect, it } from "vitest";
import {
  aggregateProjectProgress,
  getTaskProgress,
  isDueSoon,
  isOverdue,
} from "./index";

const completed = { completed: true };
const pending = { completed: false };

describe("getTaskProgress", () => {
  it("有子任务时按已完成比例计算", () => {
    expect(
      getTaskProgress({
        status: "todo",
        subtasks: [completed, completed, completed, pending, pending],
      }),
    ).toBe(0.6);
  });

  it("空子任务数组且状态为 todo 时返回 0（非 NaN）", () => {
    const progress = getTaskProgress({ status: "todo", subtasks: [] });
    expect(progress).toBe(0);
    expect(Number.isNaN(progress)).toBe(false);
  });

  it("无子任务时按状态映射 todo=0、in_progress=0.5、done=1", () => {
    expect(getTaskProgress({ status: "todo", subtasks: [] })).toBe(0);
    expect(getTaskProgress({ status: "in_progress", subtasks: [] })).toBe(0.5);
    expect(getTaskProgress({ status: "done", subtasks: [] })).toBe(1);
  });
});

describe("aggregateProjectProgress", () => {
  it("空项目返回 0", () => {
    expect(aggregateProjectProgress([], 0)).toBe(0);
  });

  it("多任务取进度简单平均", () => {
    expect(aggregateProjectProgress([0.6, 0.2, 1], 3)).toBe(0.6);
  });

  it("单任务返回其自身进度", () => {
    expect(aggregateProjectProgress([0.5], 1)).toBe(0.5);
  });
});

describe("isOverdue / isDueSoon（today = 2026-10-21）", () => {
  const today = "2026-10-21";

  it("昨天未完成：逾期但不临期", () => {
    expect(isOverdue("2026-10-20", "todo", today)).toBe(true);
    expect(isDueSoon("2026-10-20", "todo", today)).toBe(false);
  });

  it("今天未完成：临期但不逾期", () => {
    expect(isOverdue("2026-10-21", "todo", today)).toBe(false);
    expect(isDueSoon("2026-10-21", "todo", today)).toBe(true);
  });

  it("明天未完成：临期", () => {
    expect(isDueSoon("2026-10-22", "todo", today)).toBe(true);
  });

  it("今天已完成：逾期与临期均不触发", () => {
    expect(isOverdue("2026-10-21", "done", today)).toBe(false);
    expect(isDueSoon("2026-10-21", "done", today)).toBe(false);
  });

  it("更早且已完成：逾期与临期均不触发", () => {
    expect(isOverdue("2026-10-19", "done", today)).toBe(false);
    expect(isDueSoon("2026-10-19", "done", today)).toBe(false);
  });
});
