import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { resolveApiToken } from "@open-doing/server-core/mcp/api-tokens";
import { registerMcpTools } from "@open-doing/server-core/mcp/tools";

/**
 * POST / —— 无状态 MCP（Streamable HTTP）端点。
 *
 * 行为与已下线的 `apps/web/src/app/api/mcp/route.ts` 逐语义一致：
 *
 * 鉴权只认 `Authorization: Bearer <odm_...>`：
 * - 缺失 / 非 Bearer 方案 / 解析失败（null）一律 401，响应不回显 token；
 * - **任何 cookie / session 都不参与鉴权**（浏览器登录态不能换取 MCP 权限）；
 * - 原文 Token 不落日志、不进响应。
 *
 * 无状态模式：每个请求构造独立的 `McpServer` + transport（sessionIdGenerator
 * 为 undefined，不签发 session，也不做会话校验），响应使用 JSON 而非 SSE 流，
 * 便于无状态部署；请求结束后的实例由 GC 回收，无需跨请求保存状态。
 *
 * GET / DELETE 显式返回 405：无状态端点没有可订阅的 SSE 流，也没有可终止的会话。
 */

/** MCP 服务器标识（initialize 响应中的 serverInfo）。 */
const SERVER_INFO = { name: "open-doing-mcp", version: "0.1.0" } as const;

/** `Bearer` 方案大小写不敏感；token 本身不含空白。 */
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/** 统一的 401：不区分失败原因，也不回显任何凭据。 */
function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/** 提取 Bearer Token；缺失、方案不符或空值都返回 null。 */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = BEARER_PATTERN.exec(header.trim());
  return match?.[1] ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return unauthorized();
  }

  const ctx = await resolveApiToken(token);
  if (!ctx) {
    return unauthorized();
  }

  const server = new McpServer(SERVER_INFO);
  // sessionIdGenerator: undefined → 无状态；enableJsonResponse → 直接返回 JSON。
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  registerMcpTools(server, ctx);
  await server.connect(transport);

  return transport.handleRequest(request);
}

/** 无状态端点不支持 GET（SSE 流）。 */
export async function GET(): Promise<Response> {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}

/** 无状态端点不支持 DELETE（无会话可终止）。 */
export async function DELETE(): Promise<Response> {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
