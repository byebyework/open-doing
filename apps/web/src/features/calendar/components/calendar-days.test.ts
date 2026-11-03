import { describe, expect, it } from "vitest";

import {
  dateKey,
  gridDateKeys,
  indexTasksByDate,
  monthAnchor,
  shiftMonth,
} from "./calendar-grid";

describe("calendar-grid", () => {
  it("2026-11 网格 42 格：周一起，首补 10-26、尾补 12-06", () => {
    // 2026-11-01 是周日：首格补到所在周的周一 10-26；固定 6 周网格。
    const keys = gridDateKeys("2026-11");

    expect(keys).toHaveLength(42);
    expect(keys[0]).toBe("2026-10-26");
    expect(keys[keys.length - 1]).toBe("2026-12-06");
    expect(keys).toContain("2026-11-01");
    expect(keys).toContain("2026-11-30");
  });

  it("2026-02（平年）网格同样补齐 42 格且跨到 3 月", () => {
    const keys = gridDateKeys("2026-02");

    expect(keys).toHaveLength(42);
    // 2026-02-01 是周日 → 首格 01-26；尾格 = 01-26 + 41 天 = 03-08。
    expect(keys[0]).toBe("2026-01-26");
    expect(keys[keys.length - 1]).toBe("2026-03-08");
  });

  it("落格映射：同日任务同组且保持原顺序，空日期不出现键", () => {
    const groups = indexTasksByDate([
      { id: "a", dueDate: "2026-11-02" },
      { id: "b", dueDate: "2026-11-05" },
      { id: "c", dueDate: "2026-11-02" },
      { id: "d", dueDate: "2026-11-05" },
    ]);

    expect([...groups.get("2026-11-02")!.map((item) => item.id)]).toEqual([
      "a",
      "c",
    ]);
    expect([...groups.get("2026-11-05")!.map((item) => item.id)]).toEqual([
      "b",
      "d",
    ]);
    expect(groups.has("2026-11-03")).toBe(false);
  });

  it("dateKey 按本地日历字段格式化，今天高亮键不受运行时时区影响", () => {
    // 组件的今天高亮即 dateKey(cell) === today；锚点用本地构造器
    // （非 `new Date("2026-11-02")` 的 UTC 解析），任意 TZ 下键不变。
    expect(dateKey(new Date(2026, 10, 2))).toBe("2026-11-02");
    expect(dateKey(monthAnchor("2026-11"))).toBe("2026-11-01");
  });

  it("shiftMonth 跨年进位与回退", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-11", -1)).toBe("2026-10");
  });
});
