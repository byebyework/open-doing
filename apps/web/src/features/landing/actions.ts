"use server";

import type { ActionResult } from "@/features/auth/actions";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, normalizeLocale } from "@/i18n/config";
import { standardFailuresForRequest } from "@/lib/action-failure";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

/**
 * 匿名访问者(落地页)切换语言偏好。
 *
 * 不查登录态、不写 users.language——登录用户的账号级语言仍以
 * `updateLanguageAction` 为唯一入口。这里只写 od_locale cookie,
 * 供未登录页与首屏渲染使用,然后刷新落地页让 RSC 重新取消息包。
 * 非法 locale 不写 cookie,走 errors 命名空间的通用失败文案。
 */
export async function setAnonymousLocaleAction(input: {
  locale: string;
}): Promise<ActionResult<void>> {
  const locale = normalizeLocale(input?.locale);
  if (input?.locale !== locale) {
    return (await standardFailuresForRequest()).custom("errors.invalidLanguage");
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  revalidatePath("/");
  return { ok: true, data: undefined };
}
