/**
 * i18n 基础常量与 locale 解析纯函数。
 *
 * 只放无 IO、无 next 依赖的代码——客户端组件、Server 端与 CJK 守卫都会复用。
 * locale 解析链路(设计文档 §locale 的来源与传递):
 * 登录态以 users.language 为每请求权威,cookie 只服务未登录页,最终回落 zh。
 */

/** 本期交付的语言集合;后续加语言只需扩这里与 messages 目录。 */
export type AppLocale = "zh" | "en";

/** 语言偏好 cookie 名;账号级切换(Server Action)写入,未登录页直接读取。 */
export const LOCALE_COOKIE = "od_locale";

/** 语言偏好 cookie 有效期:1 年(秒)。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 兜底语言:全站默认中文,不做浏览器语言探测(设计文档已定)。 */
export const DEFAULT_LOCALE: AppLocale = "zh";

/** <html lang> 取值,与根布局输出一致。 */
export const LOCALE_HTML_LANG: Record<AppLocale, "zh-CN" | "en-US"> = {
  zh: "zh-CN",
  en: "en-US",
};

/** dayjs locale 包名(需 import "dayjs/locale/<name>")。 */
export const DAYJS_LOCALE_NAME: Record<AppLocale, "zh-cn" | "en"> = {
  zh: "zh-cn",
  en: "en",
};

/** 任意来源的 locale 字符串 → 合法 AppLocale;非法一律回落 zh。 */
export function normalizeLocale(value: string | undefined | null): AppLocale {
  return value === "zh" || value === "en" ? value : DEFAULT_LOCALE;
}

/**
 * 请求级 locale 决策:登录用户语言(合法时)优先于 cookie。
 * DB 是唯一权威(多设备切换即时生效),cookie 只覆盖未登录请求。
 */
export function resolveRequestLocale(input: {
  userLanguage?: string | null;
  cookieLocale?: string | null;
}): AppLocale {
  if (input.userLanguage === "zh" || input.userLanguage === "en") {
    return input.userLanguage;
  }
  return normalizeLocale(input.cookieLocale);
}
