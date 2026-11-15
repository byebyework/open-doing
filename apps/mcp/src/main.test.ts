import { describe, expect, it } from "vitest";

import { app } from "./main";

/**
 * Hono 接线测试：确认标准 `Request` 被原样交给 MCP handler，
 * 且 `GET /`、`DELETE /` 与 `/healthz` 的路由语义和 web 端点一致。
 */
describe("Hono app", () => {
  it("GET /healthz → 200 { ok: true }", async () => {
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("GET / → 405，Allow: POST", async () => {
    const response = await app.request("/");

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  });

  it("DELETE / → 405，Allow: POST", async () => {
    const response = await app.request("/", { method: "DELETE" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  });

  it("POST / 无 Authorization → 401（标准 Request 透传给 MCP handler）", async () => {
    const response = await app.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
