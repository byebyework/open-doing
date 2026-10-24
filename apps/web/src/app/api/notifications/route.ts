import { NextResponse, type NextRequest } from "next/server";

import { getSessionUserId } from "@/features/auth/session";
import { getUnreadNotificationCount, listNotifications } from "@/features/notifications/queries";

/** 轮询列表默认条数（与查询层一致）。 */
const DEFAULT_LIMIT = 20;
/** 单次轮询条数上限，防止客户端传入过大值拖垮查询与序列化。 */
const MAX_LIMIT = 100;

/**
 * 解析 `?limit=`：仅接受 1..100 的整数。
 *
 * 缺失、非法（含小数/非数字）或越界时一律回落默认值——入口层兜底
 * `listNotifications` 不校验 limit 的缺口（负数/0 会直接触发 Postgres 错误）。
 */
function parseLimit(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_LIMIT;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return DEFAULT_LIMIT;
  }

  return value;
}

/**
 * GET /api/notifications —— 通知中心轮询读接口。
 *
 * 未登录 401；登录后只看本人通知，返回未读数与按创建时间倒序的列表。
 * Route Handler 默认不缓存（Next 16），且 `getSessionUserId()` 读取 cookies
 * 属于请求期数据，无需额外 `export const dynamic`。
 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const [unreadCount, items] = await Promise.all([
    getUnreadNotificationCount(userId),
    listNotifications({ userId, limit }),
  ]);

  return NextResponse.json({ ok: true, unreadCount, items });
}
