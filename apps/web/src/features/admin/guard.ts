import type { User } from "@open-doing/types";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/features/auth/session";

/**
 * 管理员工作台页面 / 布局守卫（服务端专用，供 RSC 直接调用）：
 * - 未登录（或被禁用后会话已清除）-> `/login`；
 * - 已登录但非管理员 -> 个人仪表盘，管理台入口不对普通用户暴露；
 * - 管理员 -> 返回领域 `User`，页面可据此渲染。
 *
 * 重定向依赖 next/navigation 的 `redirect()`（以抛出 NEXT_REDIRECT 结束
 * 控制流）。本守卫只负责页面级拦截：管理台的每个 Server Action 仍必须
 * 自行鉴权（见服务层权限校验），不能依赖入口隐藏。
 */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/space/personal/dashboard");
  return user;
}
