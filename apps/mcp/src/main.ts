import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { pathToFileURL } from "node:url";

import { DELETE, GET, POST } from "./route";

/**
 * 独立 MCP 服务进程。
 *
 * - `POST /` → MCP（Streamable HTTP，无状态、Bearer Token 鉴权，见 `route.ts`）；
 * - `GET /` / `DELETE /` → 405 + `Allow: POST`；
 * - `GET /healthz` → 200 `{ ok: true }`，供容器/负载均衡健康检查。
 *
 * 端口来自 `MCP_PORT`，默认 3101。Hono 直接透传标准 `Request` / `Response`，
 * 因此 SDK 的 `WebStandardStreamableHTTPServerTransport` 无需适配层。
 */

export function createApp(): Hono {
  const app = new Hono();

  app.post("/", (c) => POST(c.req.raw));
  app.get("/", () => GET());
  app.delete("/", () => DELETE());
  app.get("/healthz", (c) => c.json({ ok: true }));

  return app;
}

export const app = createApp();

/** 仅当本文件作为入口执行时启动监听（测试/库导入时不占端口）。 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  const port = Number(process.env.MCP_PORT || 3101);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`open-doing MCP server listening on http://localhost:${info.port}`);
  });
}
