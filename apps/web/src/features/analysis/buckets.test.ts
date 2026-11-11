import { addDays } from "@open-doing/types";
import { describe, expect, it } from "vitest";

import {
  bucketIndexForDay,
  futureDueBuckets,
  parseAnalysisRange,
  rangeWindow,
  recentWeekBuckets,
  shanghaiDay,
  trendBuckets,
  type TrendBucket,
} from "./buckets";

// 钉住宿主时区：`shanghaiDay` 的零点翻转断言只有在宿主 TZ 固定后
// 才能稳定暴露「漏写 timeZone 选项」这类回归（本机 CST 下 UTC 15:59 恰好也是同日）。
process.env.TZ = "UTC";

describe("parseAnalysisRange", () => {
  it.each([
    ["7", 7],
    ["30", 30],
    ["90", 90],
  ] as const)("%s → %s", (param, expected) => {
    expect(parseAnalysisRange(param)).toBe(expected);
  });

  it.each([
    undefined,
    "abc",
    ["7"],
    ["7", "30"],
    "30 ",
    "",
    "0",
    "300",
  ])("非法外输入 %j → 30", (param) => {
    expect(parseAnalysisRange(param)).toBe(30);
  });
});

describe("rangeWindow", () => {
  it("2026-10-30 + 30 天 → 2026-10-01 ~ 2026-10-30", () => {
    expect(rangeWindow("2026-10-30", 30)).toEqual({
      start: "2026-10-01",
      end: "2026-10-30",
    });
  });
  it("2026-10-30 + 7 天 → 2026-10-24 ~ 2026-10-30", () => {
    expect(rangeWindow("2026-10-30", 7)).toEqual({
      start: "2026-10-24",
      end: "2026-10-30",
    });
  });
});

describe("trendBuckets", () => {
  it("30 天 → 30 个逐日桶，首桶 10-01，末桶 10-30", () => {
    const buckets = trendBuckets("2026-10-30", 30);
    expect(buckets).toHaveLength(30);
    expect(buckets[0]).toEqual({
      label: "2026-10-01",
      start: "2026-10-01",
      end: "2026-10-01",
    });
    expect(buckets[29]).toEqual({
      label: "2026-10-30",
      start: "2026-10-30",
      end: "2026-10-30",
    });
  });
  it("7 天 → 7 个逐日桶", () => {
    const buckets = trendBuckets("2026-10-30", 7);
    expect(buckets).toHaveLength(7);
    expect(buckets[0]?.start).toBe("2026-10-24");
    expect(buckets[6]?.start).toBe("2026-10-30");
  });
  it("90 天 → 周桶跨年：首桶起点 2026-10-05（周一），共 14 桶，末桶 end 截到 2027-01-05", () => {
    const buckets = trendBuckets("2027-01-05", 90);
    expect(buckets).toHaveLength(14);
    expect(buckets[0]).toEqual({
      label: "2026-10-05",
      start: "2026-10-05",
      end: "2026-10-11",
    });
    expect(buckets[13]).toEqual({
      label: "2027-01-04",
      start: "2027-01-04",
      end: "2027-01-05",
    });
  });
  it("90 天第二锚点（首桶起点到今天差 95 天，余 4）：2026-11-20 → 14 桶，末桶 11-16 ~ 11-20", () => {
    const buckets = trendBuckets("2026-11-20", 90);
    expect(buckets).toHaveLength(14);
    expect(buckets[0]).toEqual({
      label: "2026-08-17",
      start: "2026-08-17",
      end: "2026-08-23",
    });
    expect(buckets[13]).toEqual({
      label: "2026-11-16",
      start: "2026-11-16",
      end: "2026-11-20",
    });
  });
  it("90 天周桶相邻 start 连续（相差 7 天），中间桶 end = start + 6", () => {
    const buckets = trendBuckets("2027-01-05", 90);
    for (let i = 1; i < buckets.length; i++) {
      const prev = buckets[i - 1]!;
      const curr = buckets[i]!;
      expect(addDays(prev.start, 7)).toBe(curr.start);
      if (i < buckets.length - 1) {
        expect(curr.end).toBe(addDays(curr.start, 6));
      }
    }
  });
});

describe("futureDueBuckets", () => {
  it("14 个逐日桶，跨月：首桶 2026-10-30，末桶 end 2026-11-12", () => {
    const buckets = futureDueBuckets("2026-10-30");
    expect(buckets).toHaveLength(14);
    expect(buckets[0]).toEqual({
      label: "2026-10-30",
      start: "2026-10-30",
      end: "2026-10-30",
    });
    expect(buckets[13]).toEqual({
      label: "2026-11-12",
      start: "2026-11-12",
      end: "2026-11-12",
    });
    expect(buckets.map((bucket) => bucket.start)).toContain("2026-10-31");
    expect(buckets.map((bucket) => bucket.start)).toContain("2026-11-01");
  });
});

describe("recentWeekBuckets", () => {
  it("6 个周桶：末桶为本自然周（2026-10-26 周一起），首桶起点 2026-09-21，相邻差 7 天", () => {
    const buckets = recentWeekBuckets("2026-10-30", 6);
    expect(buckets).toHaveLength(6);
    expect(buckets[0]!.start).toBe("2026-09-21");
    expect(buckets[0]!.end).toBe("2026-09-27");
    expect(buckets[5]!.start).toBe("2026-10-26");
    expect(buckets[5]!.end).toBe("2026-11-01");
    for (let i = 1; i < buckets.length; i++) {
      const prev = buckets[i - 1]!;
      const curr = buckets[i]!;
      expect(addDays(prev.start, 7)).toBe(curr.start);
      expect(addDays(prev.end, 7)).toBe(curr.end);
    }
  });
});

describe("bucketIndexForDay", () => {
  const buckets = futureDueBuckets("2026-10-30");

  it("命中首 / 中 / 尾桶返回对应下标", () => {
    expect(bucketIndexForDay(buckets, "2026-10-30")).toBe(0);
    expect(bucketIndexForDay(buckets, "2026-11-06")).toBe(7);
    expect(bucketIndexForDay(buckets, "2026-11-12")).toBe(13);
  });
  it("早于首桶 / 晚于末桶 / 桶间空隙日返回 -1", () => {
    expect(bucketIndexForDay(buckets, "2026-10-29")).toBe(-1);
    expect(bucketIndexForDay(buckets, "2026-11-13")).toBe(-1);

    const gapped: TrendBucket[] = [
      { label: "2026-01-01", start: "2026-01-01", end: "2026-01-02" },
      { label: "2026-01-05", start: "2026-01-05", end: "2026-01-06" },
    ];
    expect(bucketIndexForDay(gapped, "2026-01-03")).toBe(-1);
    expect(bucketIndexForDay(gapped, "2026-01-05")).toBe(1);
  });
});

describe("shanghaiDay", () => {
  it("UTC 15:59 = 上海 23:59，仍是同一天", () => {
    expect(shanghaiDay(new Date("2026-10-31T15:59:00Z"))).toBe("2026-10-31");
  });
  it("UTC 16:01 = 上海次日零点后，翻到 11-01", () => {
    expect(shanghaiDay(new Date("2026-10-31T16:01:00Z"))).toBe("2026-11-01");
  });
});
