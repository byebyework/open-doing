import { describe, expect, it } from "vitest";
import { generateUid } from "./uid";

describe("generateUid", () => {
  it("生成 doing_ + 6 位小写字母数字，且不含易混淆字符 i/l/o/0/1", () => {
    for (let i = 0; i < 100; i += 1) {
      const uid = generateUid();
      expect(uid).toMatch(/^doing_[a-z2-9]{6}$/);
      // 正则中的 [a-z] 本身包含 i/l/o，需要单独断言剔除。
      expect(uid.slice("doing_".length)).not.toMatch(/[ilo01]/);
    }
  });

  it("连续 500 次调用互不相同", () => {
    const uids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      uids.add(generateUid());
    }
    expect(uids.size).toBe(500);
  });
});
