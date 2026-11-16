import { describe, expect, it } from "vitest";

import { axisLabelStep } from "./axis";

describe("axisLabelStep", () => {
  it("wide 每 5 桶一个标签（现状口径）", () => {
    expect(axisLabelStep("wide")).toBe(5);
  });

  it("narrow 每 10 桶一个标签（半宽卡片防溢出）", () => {
    expect(axisLabelStep("narrow")).toBe(10);
  });
});
