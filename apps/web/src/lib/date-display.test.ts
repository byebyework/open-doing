import { describe, expect, it } from "vitest";

import { formatTaskDate, formatTaskTimestamp } from "./date-display";

describe("formatTaskDate", () => {
  it("YYYY-MM-DD 原样返回（存储格式即展示格式）", () => {
    expect(formatTaskDate("2026-10-22")).toBe("2026-10-22");
    expect(formatTaskDate("2026-01-05")).toBe("2026-01-05");
  });

  it("畸形输入原样返回：不格式化、不抛错、不产生 Invalid Date", () => {
    expect(formatTaskDate("garbage")).toBe("garbage");
    expect(formatTaskDate("2026/10/22")).toBe("2026/10/22");
    expect(formatTaskDate("")).toBe("");
  });
});

describe("formatTaskTimestamp", () => {
  it("按 Asia/Shanghai 输出 YYYY-MM-DD HH:mm", () => {
    // UTC 2026-10-22 02:30 = 上海 2026-10-22 10:30。
    expect(formatTaskTimestamp(new Date(Date.UTC(2026, 9, 22, 2, 30)))).toBe(
      "2026-10-22 10:30",
    );
  });

  it("跨 UTC 日期边界：UTC 傍晚归入上海次日", () => {
    // UTC 2026-10-21 17:30 = 上海 2026-10-22 01:30。
    expect(formatTaskTimestamp(new Date(Date.UTC(2026, 9, 21, 17, 30)))).toBe(
      "2026-10-22 01:30",
    );
  });

  it("零点用 h23 表示为 00:mm，不是 24:mm", () => {
    // UTC 2026-10-21 16:00 = 上海 2026-10-22 00:00。
    expect(formatTaskTimestamp(new Date(Date.UTC(2026, 9, 21, 16, 0)))).toBe(
      "2026-10-22 00:00",
    );
  });

  it("接受 ISO 字符串", () => {
    expect(formatTaskTimestamp("2026-10-22T02:30:00.000Z")).toBe(
      "2026-10-22 10:30",
    );
  });
});
