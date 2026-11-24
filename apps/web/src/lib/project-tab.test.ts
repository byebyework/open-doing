import { describe, expect, it } from "vitest";

import { PROJECT_TAB_PARAM, parseProjectTab } from "./project-tab";

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
