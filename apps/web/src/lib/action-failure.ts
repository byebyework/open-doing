import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";
import { getRequestLocale, loadMessages } from "@/i18n/server";
import { createTranslator, type AppMessages, type TranslateFn } from "@/i18n/translate";

import type { ActionFailure } from "./domain-failure";

/**
 * 三个标准 action 失败(请先登录 / 无权限 / 操作失败)+ 自定义 key 的
 * 统一出口。收敛原先 9 个 feature 各写一份的中文字面量;文案与
 * messages JSON 同源,zh 值与原字面量逐字一致。
 *
 * 日志仍由各 action 的 catch 负责,这里不吞错误栈。
 */
export function standardFailures(t: TranslateFn) {
  return {
    notLoggedIn: (): ActionFailure => ({
      ok: false,
      errors: { form: t("errors.notLoggedIn") },
    }),
    forbidden: (): ActionFailure => ({
      ok: false,
      errors: { form: t("errors.forbidden") },
    }),
    unexpected: (): ActionFailure => ({
      ok: false,
      errors: { form: t("errors.operationFailed") },
    }),
    /** 非三件套的自定义文案(仍走同一 translator,保证与 UI 同语言)。 */
    custom: (key: string, values?: Record<string, string | number>): ActionFailure => ({
      ok: false,
      errors: { form: t(key, values) },
    }),
  };
}

/**
 * 请求级实例:locale 来自请求解析(DB 权威),messages 走模块级缓存。
 * 无请求上下文的场景(vitest 直调 action、cron)回落 zh——
 * zh 值与迁移前字面量逐字一致,行为不变。
 */
export async function standardFailuresForRequest() {
  try {
    const locale: AppLocale = await getRequestLocale();
    return standardFailures(createTranslator(await loadMessages(locale)));
  } catch {
    return standardFailures(createTranslator(zh as AppMessages));
  }
}
