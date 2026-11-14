import { describe, expect, it } from "vitest";

import { resolveBuildInfo, splitUptime } from "./system-info";

describe("splitUptime", () => {
  it("returns all null under a minute (page shows 不到 1 分钟)", () => {
    expect(splitUptime(0)).toEqual({ days: null, hours: null, minutes: null });
    expect(splitUptime(59)).toEqual({ days: null, hours: null, minutes: null });
  });

  it("returns minutes only under an hour", () => {
    expect(splitUptime(60)).toEqual({ days: null, hours: null, minutes: 1 });
    expect(splitUptime(59 * 60 + 59)).toEqual({
      days: null,
      hours: null,
      minutes: 59,
    });
  });

  it("returns hours + minutes under a day", () => {
    expect(splitUptime(60 * 60)).toEqual({ days: null, hours: 1, minutes: 0 });
    expect(splitUptime(23 * 3600 + 30 * 60)).toEqual({
      days: null,
      hours: 23,
      minutes: 30,
    });
  });

  it("returns days + hours past a day", () => {
    // 3 天 4 小时： README 原型示例口径
    expect(splitUptime(3 * 86400 + 4 * 3600 + 25 * 60)).toEqual({
      days: 3,
      hours: 4,
      minutes: null,
    });
    expect(splitUptime(86400)).toEqual({ days: 1, hours: 0, minutes: null });
  });
});

describe("resolveBuildInfo", () => {
  it("returns both values when the build env is present", () => {
    expect(
      resolveBuildInfo({
        GIT_COMMIT_SHA: "e3f1c2a7d4b5",
        BUILD_TIME: "2026-11-14 10:32",
      }),
    ).toEqual({ commit: "e3f1c2a7d4b5", buildTime: "2026-11-14 10:32" });
  });

  it("returns nulls when the env is missing (dev mode)", () => {
    expect(resolveBuildInfo({})).toEqual({ commit: null, buildTime: null });
    expect(resolveBuildInfo({ GIT_COMMIT_SHA: "  ", BUILD_TIME: "" })).toEqual({
      commit: null,
      buildTime: null,
    });
  });
});
