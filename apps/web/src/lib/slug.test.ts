import { describe, expect, it, vi } from "vitest";

import { generateUniqueSlug, slugWithCounter, slugifyName } from "./slug";

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

/** 基础用例：任何 slug 都未被占用。 */
const neverTaken = async () => false;

describe("generateUniqueSlug", () => {
  it("纯 ASCII：转小写并把非字母数字字符归一为 -", async () => {
    await expect(generateUniqueSlug("My Project!", neverTaken)).resolves.toBe(
      "my-project",
    );
  });

  it("中英混合：去掉中文后保留 ASCII 片段", async () => {
    const slug = await generateUniqueSlug("学习 growth", neverTaken);

    expect(slug).toBe("growth");
    expect(slug).toContain("growth");
  });

  it("纯中文：base 为空时回落为 project", async () => {
    await expect(generateUniqueSlug("学习成长", neverTaken)).resolves.toBe(
      "project",
    );
  });

  it("base 被占用时追加 -2", async () => {
    const isTaken = vi.fn(async (slug: string) => slug === "project");

    await expect(generateUniqueSlug("学习成长", isTaken)).resolves.toBe(
      "project-2",
    );
    expect(isTaken).toHaveBeenCalledWith("project");
    expect(isTaken).toHaveBeenCalledWith("project-2");
  });

  it("连续冲突时依次尝试 -2、-3", async () => {
    const isTaken = async (slug: string) =>
      slug === "my-project" || slug === "my-project-2";

    await expect(generateUniqueSlug("My Project", isTaken)).resolves.toBe(
      "my-project-3",
    );
  });

  it("首尾与连续分隔符会被归一", async () => {
    await expect(
      generateUniqueSlug("  --Hello__World--  ", neverTaken),
    ).resolves.toBe("hello-world");
  });
});
