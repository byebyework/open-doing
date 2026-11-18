import { describe, expect, it } from "vitest";

import { columnTitle, type TrendSeries } from "./chart-title";

describe("columnTitle", () => {
  const done = (values: number[]): TrendSeries => ({ tone: "primary", values });
  const created = (values: number[]): TrendSeries => ({ tone: "teal", values });

  it("单系列今日桶：今天前缀 + 完成数", () => {
    expect(
      columnTitle({
        bucketLabel: "2026-11-14",
        isToday: true,
        todayPrefix: "今天",
        series: [done([0, 1])],
        index: 1,
        doneTemplate: "完成 {value}",
        createdTemplate: "新增 {value}",
        unchangedLabel: "无变化",
      }),
    ).toBe("今天 2026-11-14 · 完成 1");
  });

  it("单系列 0 值使用 emptyLabel", () => {
    expect(
      columnTitle({
        bucketLabel: "2026-11-15",
        isToday: false,
        todayPrefix: "今天",
        series: [done([0])],
        index: 0,
        emptyLabel: "无",
        doneTemplate: "完成 {value}",
        createdTemplate: "新增 {value}",
        unchangedLabel: "无变化",
      }),
    ).toBe("2026-11-15 · 无");
  });

  it("单系列自定义模板（未来截止分布）", () => {
    expect(
      columnTitle({
        bucketLabel: "2026-11-16",
        isToday: false,
        todayPrefix: "今天",
        series: [done([0, 2])],
        index: 1,
        singleValueTemplate: "{value} 项到期",
        doneTemplate: "完成 {value}",
        createdTemplate: "新增 {value}",
        unchangedLabel: "无变化",
      }),
    ).toBe("2026-11-16 · 2 项到期");
  });

  it("双系列非 0：新增在前、完成在后", () => {
    expect(
      columnTitle({
        bucketLabel: "2026-11-16",
        isToday: false,
        todayPrefix: "今天",
        series: [created([2]), done([1])],
        index: 0,
        doneTemplate: "完成 {value}",
        createdTemplate: "新增 {value}",
        unchangedLabel: "无变化",
      }),
    ).toBe("2026-11-16 · 新增 2 / 完成 1");
  });

  it("双系列全 0：无变化", () => {
    expect(
      columnTitle({
        bucketLabel: "2026-11-17",
        isToday: false,
        todayPrefix: "今天",
        series: [created([0]), done([0])],
        index: 0,
        doneTemplate: "完成 {value}",
        createdTemplate: "新增 {value}",
        unchangedLabel: "无变化",
      }),
    ).toBe("2026-11-17 · 无变化");
  });

  it("双系列部分非 0：只列有值的系列", () => {
    expect(
      columnTitle({
        bucketLabel: "2026-11-18",
        isToday: false,
        todayPrefix: "今天",
        series: [created([0]), done([3])],
        index: 0,
        doneTemplate: "完成 {value}",
        createdTemplate: "新增 {value}",
        unchangedLabel: "无变化",
      }),
    ).toBe("2026-11-18 · 完成 3");
  });
});
