import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ApiTokenContext } from "./api-tokens";

/**
 * MCP 工具的注册扩展点。
 *
 * - 每个请求都会构造全新的 `McpServer`（无状态模式），这里按 Token 解析出的
 *   `ctx`（签发者 + 被代理的虚拟成员 + 所属团队）注册该身份可用的工具。
 * - Task 16/17 在此接入真实工具；当前仅完成握手，不注册任何工具。
 * - 权限必须在工具实现内部再次校验：Token 只证明“是谁”，不证明“能改什么”。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 稳定签名，Task 16/17 接入真实工具后即被使用
export function registerMcpTools(_server: McpServer, _ctx: ApiTokenContext): void {
  // 暂无工具：Task 16/17 注册任务/项目相关工具。
}
