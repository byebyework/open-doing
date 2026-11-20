import { describe, expect, it } from "vitest";

import { greetingKey } from "./today";

/** UTC 时刻 → 上海时段的边界用例（上海 = UTC+8）。 */
function utc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, 20, hour, minute));
}

describe("greetingKey", () => {
  it("早晨：上海 05:00–11:59（UTC 21:00–03:59）", () => {
    expect(greetingKey(utc(21))).toBe("morning"); // 上海 05:00
    expect(greetingKey(utc(22, 30))).toBe("morning"); // 上海 06:30
    expect(greetingKey(utc(3, 59))).toBe("morning"); // 上海 11:59
  });

  it("下午：上海 12:00–17:59（UTC 04:00–09:59）", () => {
    expect(greetingKey(utc(4))).toBe("afternoon"); // 上海 12:00
    expect(greetingKey(utc(9, 59))).toBe("afternoon"); // 上海 17:59
  });

  it("晚上：上海 18:00–04:59（UTC 10:00–20:59）", () => {
    expect(greetingKey(utc(10))).toBe("evening"); // 上海 18:00
    expect(greetingKey(utc(20, 59))).toBe("evening"); // 上海 04:59
  });

  it("不依赖本地时区：UTC+8 显式偏移", () => {
    expect(greetingKey(utc(8))).toBe("afternoon"); // 上海 16:00
    expect(greetingKey(utc(12))).toBe("evening"); // 上海 20:00
  });
});
