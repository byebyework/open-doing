import { describe, expect, it } from "vitest";

import { tickDisplayLabel, xTickIndexes } from "./axis";

describe("xTickIndexes", () => {
  it("wide 每 5 桶标注并恒含末桶", () => {
    expect(xTickIndexes(30, "wide")).toEqual([0, 5, 10, 15, 20, 25, 29]);
  });

  it("narrow 每 10 桶标注并恒含末桶", () => {
    expect(xTickIndexes(14, "narrow")).toEqual([0, 10, 13]);
  });

  it("0 桶与单桶边界", () => {
    expect(xTickIndexes(0, "wide")).toEqual([]);
    expect(xTickIndexes(1, "narrow")).toEqual([0]);
  });
});

describe("tickDisplayLabel", () => {
  it("首桶保留完整日期", () => {
    expect(tickDisplayLabel("2026-11-18", 0, 14)).toBe("2026-11-18");
  });

  it("中间桶只取 MM-DD", () => {
    expect(tickDisplayLabel("2026-11-20", 5, 30)).toBe("11-20");
  });

  it("末桶保留完整日期", () => {
    expect(tickDisplayLabel("2026-11-30", 29, 30)).toBe("2026-11-30");
  });
});
