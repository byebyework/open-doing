import type { NextRequest } from "next/server";

/**
 * cron 路由鉴权：请求密钥必须与 `CRON_SECRET` 完全一致。
 *
 * 接受两种取钥方式（满足不同 cron 平台的配置习惯）：
 * - `Authorization: Bearer ${CRON_SECRET}`
 * - `x-cron-key: ${CRON_SECRET}`
 *
 * `CRON_SECRET` 未配置或为空时一律拒绝，避免“没配密钥就能跑”的隐患。
 * 单独放在 route 文件之外：Next 的路由类型只允许导出 HTTP 方法与路由配置，
 * 未知导出会导致类型检查失败；这样也便于纯函数单测。
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  if (request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }

  return request.headers.get("x-cron-key") === secret;
}
