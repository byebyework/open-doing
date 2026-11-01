import { describe, expect, it } from "vitest";

import { createTranslator } from "./translate";

const messages = {
  common: {
    save: "保存",
    greeting: "你好，{name}",
  },
  nested: {
    deep: {
      key: "deep value",
    },
  },
};

describe("createTranslator", () => {
  const t = createTranslator(messages);

  it("resolves dot-path keys", () => {
    expect(t("common.save")).toBe("保存");
    expect(t("nested.deep.key")).toBe("deep value");
  });

  it("interpolates {name} placeholders", () => {
    expect(t("common.greeting", { name: "林夏" })).toBe("你好，林夏");
  });

  it("throws on a missing key (fail fast in tests)", () => {
    expect(() => t("common.missing")).toThrow(/\[i18n\] missing key: common\.missing/);
  });

  it("throws on a non-string leaf", () => {
    const bad = createTranslator({ bad: { key: 42 as unknown as string } });
    expect(() => bad("bad.key")).toThrow(/not a string/);
  });
});
