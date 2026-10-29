import { describe, expect, it } from "vitest";

import { weekdayLabel } from "./today";

describe("weekdayLabel", () => {
  it.each([
    ["2026-10-21", "周三"],
    ["2026-10-25", "周日"],
    ["2026-10-26", "周一"],
    ["2026-10-31", "周六"],
  ])("%s → %s", (date, label) => {
    expect(weekdayLabel(date)).toBe(label);
  });
});
