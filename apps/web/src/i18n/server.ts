import { cookies } from "next/headers";
import { cache } from "react";
import { getRequestConfig } from "next-intl/server";

import { getSessionUserId } from "@/features/auth/session";
import { getUserLanguage } from "@/features/users/service";

import {
  LOCALE_COOKIE,
  normalizeLocale,
  resolveRequestLocale,
  type AppLocale,
} from "./config";
import type { AppMessages } from "./translate";

/**
 * 请求级 locale(每请求缓存):
 * 登录态以 users.language 为唯一权威(多设备切换即时生效);
 * 未登录读 cookie;两者皆无回落 zh。见设计文档 §locale 的来源与传递。
 */
export const getRequestLocale = cache(async (): Promise<AppLocale> => {
  const userId = await getSessionUserId();
  if (userId) {
    const language = await getUserLanguage(userId);
    if (language) return language;
  }

  const cookieStore = await cookies();
  return resolveRequestLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
  });
});

/** next-intl 约定入口:locale + 对应 messages。 */
export default getRequestConfig(async () => {
  const locale = await getRequestLocale();
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});

/** messages 加载缓存(模块级,每 locale 只 import 一次)。 */
const messagesCache = {} as Record<AppLocale, Promise<AppMessages>>;

/**
 * 加载指定 locale 的完整 messages(供 Server Action 错误翻译等
 * 非渲染场景使用;渲染走 next-intl 的 getRequestConfig)。
 */
export function loadMessages(locale: AppLocale): Promise<AppMessages> {
  messagesCache[locale] ??= import(`./messages/${locale}.json`).then(
    (m) => m.default,
  );
  return messagesCache[locale];
}
