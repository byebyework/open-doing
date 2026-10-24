import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { isAuthorizedCronRequest } from "./auth";

const SECRET = "test-cron-secret";

const originalSecret = process.env.CRON_SECRET;

function setSecret(value: string | undefined) {
  if (value === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = value;
  }
}

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/due-scan", {
    method: "POST",
    headers,
  });
}

describe("isAuthorizedCronRequest", () => {
  afterEach(() => {
    setSecret(originalSecret);
  });

  it("CRON_SECRET 未配置时一律拒绝", () => {
    setSecret(undefined);

    expect(isAuthorizedCronRequest(request())).toBe(false);
    expect(
      isAuthorizedCronRequest(request({ authorization: `Bearer ${SECRET}` })),
    ).toBe(false);
    expect(isAuthorizedCronRequest(request({ "x-cron-key": SECRET }))).toBe(false);
  });

  it("CRON_SECRET 为空字符串时一律拒绝", () => {
    setSecret("");

    expect(isAuthorizedCronRequest(request({ "x-cron-key": "" }))).toBe(false);
  });

  it("接受 Authorization: Bearer <secret>", () => {
    setSecret(SECRET);

    expect(
      isAuthorizedCronRequest(request({ authorization: `Bearer ${SECRET}` })),
    ).toBe(true);
  });

  it("接受 x-cron-key: <secret>", () => {
    setSecret(SECRET);

    expect(isAuthorizedCronRequest(request({ "x-cron-key": SECRET }))).toBe(true);
  });

  it.each([
    ["无密钥", {}],
    ["错误的 Bearer", { authorization: "Bearer wrong-secret" }],
    ["错误的 x-cron-key", { "x-cron-key": "wrong-secret" }],
    ["非 Bearer 方案", { authorization: `Basic ${SECRET}` }],
    ["缺少 Bearer 前缀", { authorization: SECRET }],
  ])("拒绝：%s", (_name, headers) => {
    setSecret(SECRET);

    expect(isAuthorizedCronRequest(request(headers))).toBe(false);
  });
});
