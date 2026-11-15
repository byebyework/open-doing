import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiTokenContext } from "./api-tokens";
import { resolveApiToken } from "./api-tokens";

import { DELETE, GET, POST } from "@/app/api/mcp/route";

/**
 * POST /api/mcp 只认 Bearer Token：handler 层不读 cookie / session，
 * 因此这里直接把 `resolveApiToken` mock 掉，专注覆盖鉴权分流与 SDK 接线。
 */
vi.mock("./api-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-tokens")>();
  return { ...actual, resolveApiToken: vi.fn() };
});

const mockResolveApiToken = vi.mocked(resolveApiToken);

/** 一个合法的虚拟成员 token 解析结果夹具。 */
const ctx: ApiTokenContext = {
  user: { id: "user-1", name: "owner" },
  virtualMember: {
    id: "vm-1",
    teamId: "team-1",
    name: "写作助手",
    role: "admin",
    description: "负责周报",
    accentColor: "#a66b00",
    createdAt: "2026-11-15T00:00:00.000Z",
  },
  team: {
    id: "team-1",
    name: "Agent Squad",
    slug: "agent-squad",
    kind: "virtual",
    ownerId: "user-1",
    createdAt: "2026-11-15T00:00:00.000Z",
  },
};

/** MCP Streamable HTTP 客户端的标准 Accept 头：必须同时声明两种类型。 */
const MCP_ACCEPT = "application/json, text/event-stream";

/** JSON-RPC initialize 请求体（握手即可验证 McpServer + transport 接线）。 */
const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "1.0.0" },
  },
});

function post(headers: Record<string, string>, body: string = INITIALIZE_BODY) {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: MCP_ACCEPT, ...headers },
      body,
    }),
  );
}

describe("POST /api/mcp", () => {
  afterEach(() => {
    mockResolveApiToken.mockReset();
  });

  it("无 Authorization 头 → 401，且不解析 token", async () => {
    const response = await post({});

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mockResolveApiToken).not.toHaveBeenCalled();
  });

  it("非 Bearer 方案（Basic）→ 401，且不解析 token", async () => {
    const response = await post({ authorization: "Basic dXNlcjpwYXNz" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mockResolveApiToken).not.toHaveBeenCalled();
  });

  it("仅有会话 cookie、没有 Bearer → 401（cookie 永远不能换取 MCP 权限）", async () => {
    const response = await post({
      cookie: "better-auth.session_token=valid-session-token",
      "x-forwarded-for": "127.0.0.1",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mockResolveApiToken).not.toHaveBeenCalled();
  });

  it("Bearer bad-token（解析失败）→ 401，响应不回显 token", async () => {
    mockResolveApiToken.mockResolvedValue(null);

    const response = await post({ authorization: "Bearer odm_bad-token" });

    expect(response.status).toBe(401);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "unauthorized" });
    expect(text).not.toContain("odm_bad-token");
    expect(mockResolveApiToken).toHaveBeenCalledExactlyOnceWith("odm_bad-token");
  });

  it("Bearer 后为空 → 401", async () => {
    const response = await post({ authorization: "Bearer " });

    expect(response.status).toBe(401);
    expect(mockResolveApiToken).not.toHaveBeenCalled();
  });

  it("有效 token + initialize → 200，响应含 serverInfo", async () => {
    mockResolveApiToken.mockResolvedValue(ctx);

    const response = await post({ authorization: "Bearer odm_valid-token" });

    expect(response.status).toBe(200);
    expect(mockResolveApiToken).toHaveBeenCalledExactlyOnceWith("odm_valid-token");

    const body = (await response.json()) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };
    expect(body.result?.serverInfo?.name).toBeTruthy();
    expect(body.result?.serverInfo?.version).toBeTruthy();
  });
});

describe("/api/mcp 非 POST 方法", () => {
  it("GET → 405（无状态端点不提供 SSE 流）", async () => {
    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("DELETE → 405（无状态端点没有可终止的会话）", async () => {
    const response = await DELETE();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
