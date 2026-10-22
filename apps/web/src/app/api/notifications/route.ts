import { NextResponse } from "next/server";

/**
 * GET /api/notifications —— 通知列表桩。
 *
 * N 轨道 M2 接管实现；在此之前恒返回 401，避免 UI 误以为已接入鉴权。
 */
export async function GET() {
  return NextResponse.json({ ok: false }, { status: 401 });
}
