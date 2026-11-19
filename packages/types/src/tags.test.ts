import { describe, expect, it } from "vitest";

import { TAG_COLORS, isTagColor } from "./tags";

describe("TAG_COLORS", () => {
  it("exposes exactly the six token palette keys", () => {
    expect([...TAG_COLORS]).toEqual([
      "purple",
      "coral",
      "tangerine",
      "mint",
      "sky",
      "lavender",
    ]);
  });
});

describe("isTagColor", () => {
  it("accepts every palette key", () => {
    for (const color of TAG_COLORS) {
      expect(isTagColor(color)).toBe(true);
    }
  });

  it("rejects a non palette string", () => {
    expect(isTagColor("blue")).toBe(false);
  });

  it("rejects a non string value", () => {
    expect(isTagColor(42)).toBe(false);
    expect(isTagColor(null)).toBe(false);
    expect(isTagColor(undefined)).toBe(false);
  });
});
