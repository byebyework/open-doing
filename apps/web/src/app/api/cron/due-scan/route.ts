import { NextResponse, type NextRequest } from "next/server";

import { runDueScan } from "@/features/notifications/due-scan";

import { isAuthorizedCronRequest } from "./auth";

/**
 * POST /api/cron/due-scan —— 到期提醒扫描入口（供外部 cron 定时调用）。
 *
 * 仅允许 POST（未导出其他方法，Next 会自动对其它方法返回 405）。
 * 鉴权失败返回 `401 { ok: false }`，且不执行任何扫描/写入。
 * 扫描失败时返回 `500 { ok: false }` JSON，确保 cron 调用方始终能解析响应。
 *
 * Route Handler 默认不缓存（Next 16；仅 GET 可显式选择缓存），
 * 因此无需 `export const dynamic`。
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const { dueSoon, overdue } = await runDueScan();
    return NextResponse.json({ ok: true, dueSoon, overdue });
  } catch (error) {
    console.error("[notifications] 到期扫描 cron 执行失败", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
