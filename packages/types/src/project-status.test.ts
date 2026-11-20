import { describe, expect, it } from "vitest";
import { getProjectStatusKind } from "./project-status";

describe("getProjectStatusKind", () => {
  it("maps 0 progress to not_started", () => {
    expect(getProjectStatusKind(0)).toBe("not_started");
  });
  it("maps 1 progress to completed", () => {
    expect(getProjectStatusKind(1)).toBe("completed");
  });
  it("maps partial progress to in_progress", () => {
    expect(getProjectStatusKind(0.49)).toBe("in_progress");
    expect(getProjectStatusKind(0.9999)).toBe("in_progress");
  });
});
