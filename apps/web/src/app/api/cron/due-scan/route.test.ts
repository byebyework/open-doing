import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDueScan } from "@/features/notifications/due-scan";

import { POST } from "./route";

vi.mock("@/features/notifications/due-scan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/notifications/due-scan")>();
  return { ...actual, runDueScan: vi.fn() };
});

const mockRunDueScan = vi.mocked(runDueScan);

const SECRET = "test-cron-secret";
const originalSecret = process.env.CRON_SECRET;

function post(headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/cron/due-scan", { method: "POST", headers }),
  );
}

describe("POST /api/cron/due-scan", () => {
  afterEach(() => {
    vi.resetAllMocks();
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("无密钥返回 401 且不执行扫描", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await post();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(mockRunDueScan).not.toHaveBeenCalled();
  });

  it("密钥错误返回 401 且不执行扫描", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await post({ authorization: "Bearer wrong-secret" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(mockRunDueScan).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 未配置时 401，即使请求带了匹配的密钥", async () => {
    delete process.env.CRON_SECRET;

    const response = await post({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(401);
    expect(mockRunDueScan).not.toHaveBeenCalled();
  });

  it.each([
    ["Authorization", { authorization: `Bearer ${SECRET}` }],
    ["x-cron-key", { "x-cron-key": SECRET }],
  ])("鉴权通过（%s）返回扫描统计", async (_name, headers) => {
    process.env.CRON_SECRET = SECRET;
    mockRunDueScan.mockResolvedValue({ dueSoon: 2, overdue: 1 });

    const response = await post(headers);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, dueSoon: 2, overdue: 1 });
    expect(mockRunDueScan).toHaveBeenCalledTimes(1);
  });

  it("扫描抛错时返回可解析的 500 JSON", async () => {
    process.env.CRON_SECRET = SECRET;
    mockRunDueScan.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(consoleError).toHaveBeenCalled();
  });
});
