import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";

import type { AppLocale } from "@/i18n/config";

const DAYJS_NAME = { zh: "zh-cn", en: "en" } as const;

/**
 * 把请求级 locale 应用为 dayjs 全局 locale。
 *
 * 相对时间文案（`fromNow()`，如 NotificationBell 的「3 小时前」）依赖
 * dayjs 的全局 locale；其余 `format()` 用法均为 locale 无关的数字/固定
 * 字形。由根 Providers 按请求调用，保证服务端渲染与客户端水合同源。
 */
export function setDayjsLocale(locale: AppLocale): string {
  const name = DAYJS_NAME[locale];
  dayjs.locale(name);
  return dayjs.locale();
}
