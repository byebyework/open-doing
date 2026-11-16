import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { spaceRefFromPathname } from "@/lib/routes";

/** 侧栏 ambient 空间 cookie：只存 spaceRef（personal 或团队 slug），服务端读取前仍会校验。 */
const AMBIENT_SPACE_COOKIE = "od_space";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const config = { matcher: "/space/:path*" };

/**
 * 记录用户最近所在空间（Next 16 的 proxy 文件约定，middleware 已改名 proxy）。
 * 同时写入 request cookie（本次渲染立即可见）与 response cookie（后续导航可见），
 * 让侧栏在 `/about`、`/invites` 等非空间路由保持空间上下文。
 */
export function proxy(request: NextRequest) {
  const spaceRef = spaceRefFromPathname(request.nextUrl.pathname);
  request.cookies.set(AMBIENT_SPACE_COOKIE, spaceRef);
  const response = NextResponse.next({ request });
  response.cookies.set(AMBIENT_SPACE_COOKIE, spaceRef, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
