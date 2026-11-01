import { describe, expect, it } from "vitest";

import en from "./messages/en.json";
import zh from "./messages/zh.json";

/** 递归收集叶子 key 路径（点号连接）。 */
function leafPaths(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") {
    return [prefix];
  }
  return Object.entries(node).flatMap(([key, value]) =>
    leafPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** zh.json 是 key 的唯一权威；en.json 必须与它一一对应（防漏翻）。 */
describe("messages key parity", () => {
  it("en 与 zh 的 key 集合完全一致", () => {
    const zhKeys = leafPaths(zh).sort();
    const enKeys = leafPaths(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("所有叶子都是非空字符串", () => {
    for (const [locale, tree] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      for (const path of leafPaths(tree)) {
        const value = path
          .split(".")
          .reduce<unknown>(
            (node, segment) =>
              node && typeof node === "object"
                ? (node as Record<string, unknown>)[segment]
                : undefined,
            tree,
          );
        expect([locale, path, value]).toSatisfy(
          ([, , v]) => typeof v === "string" && (v as string).length > 0,
        );
      }
    }
  });
});
