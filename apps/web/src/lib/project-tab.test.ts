import { describe, expect, it } from "vitest";

import {
  PROJECT_TAB_PARAM,
  parseProjectTab,
  parseProjectTaskFilters,
} from "./project-tab";

describe("parseProjectTab", () => {
  it("PROJECT_TAB_PARAM 为 tab", () => {
    expect(PROJECT_TAB_PARAM).toBe("tab");
  });

  it("tasks / activity 解析为对应值（含数组首项）", () => {
    expect(parseProjectTab("tasks")).toBe("tasks");
    expect(parseProjectTab("activity")).toBe("activity");
    expect(parseProjectTab(["activity"])).toBe("activity");
  });

  it("缺省 / 非法值回落 overview", () => {
    expect(parseProjectTab(undefined)).toBe("overview");
    expect(parseProjectTab("")).toBe("overview");
    expect(parseProjectTab("bogus")).toBe("overview");
    expect(parseProjectTab([123 as unknown as string])).toBe("overview");
  });
});

describe("parseProjectTaskFilters", () => {
  it("合法 status/priority/tag 透传", () => {
    expect(
      parseProjectTaskFilters({ status: "in_progress", priority: "high", tag: "t1" }),
    ).toEqual({
      status: "in_progress",
      priority: "high",
      tag: "t1",
      milestone: "all",
    });
  });

  it("非法 / 缺省值回 all", () => {
    expect(parseProjectTaskFilters({ status: "bogus", priority: "9", tag: "" })).toEqual({
      status: "all",
      priority: "all",
      tag: "all",
      milestone: "all",
    });
    expect(parseProjectTaskFilters({})).toEqual({
      status: "all",
      priority: "all",
      tag: "all",
      milestone: "all",
    });
    // 数组形态（Next 同名参数）取首项。
    expect(parseProjectTaskFilters({ status: ["done", "todo"] }).status).toBe("done");
  });

  it("解析 milestone（非空透传，缺省 all）", () => {
    expect(parseProjectTaskFilters({ milestone: "ms-1" }).milestone).toBe("ms-1");
    expect(parseProjectTaskFilters({}).milestone).toBe("all");
    expect(parseProjectTaskFilters({ milestone: "" }).milestone).toBe("all");
  });
});
