import { describe, expect, it } from "vitest";
import { generateJoinCode } from "./join-code";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

describe("generateJoinCode", () => {
  it("生成 8 位大写码，全部落在字符集内且不含 I/L/O", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(code.length).toBe(8);
      // 正则中的 [A-Z] 本身包含 I/L/O，需要单独断言剔除。
      expect(code).not.toMatch(/[ILO]/);
      for (const char of code) {
        expect(ALPHABET).toContain(char);
      }
    }
  });

  it("连续 200 次采样去重后不少于 150 个（分布健全性）", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      codes.add(generateJoinCode());
    }
    expect(codes.size).toBeGreaterThanOrEqual(150);
  });
});
