import { describe, expect, it } from "vitest";

import { slugWithCounter, slugifyName } from "./slug";

describe("slugifyName", () => {
  it("ASCII 名称：小写、空白折叠为连字符", () => {
    expect(slugifyName("Growth Squad")).toBe("growth-squad");
    expect(slugifyName("  Web 2.0  ")).toBe("web-2-0");
  });

  it("混合名称：只保留 ASCII 片段", () => {
    expect(slugifyName("T2 增长突击队")).toBe("t2");
  });

  it("纯中文名称：回退为 team", () => {
    expect(slugifyName("增长突击队")).toBe("team");
  });

  it("结果截断至 40 字符", () => {
    expect(slugifyName("a".repeat(60)).length).toBe(40);
  });

  it("空名称：回退为 team", () => {
    expect(slugifyName("")).toBe("team");
    expect(slugifyName("！！！")).toBe("team");
  });
});

describe("slugWithCounter", () => {
  it("首个不加计数，之后追加 -n", () => {
    expect(slugWithCounter("team", 1)).toBe("team");
    expect(slugWithCounter("team", 2)).toBe("team-2");
  });
});
