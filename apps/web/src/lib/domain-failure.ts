import { DomainError } from "./domain-error";
import type { TranslateFn } from "@/i18n/translate";

/** ActionResult 失败侧结构(与各 feature actions 的 toFailure 一致)。 */
export interface ActionFailure {
  ok: false;
  errors: Record<string, string>;
}

/**
 * 构造共享的 action 失败映射(各 feature 的 `toFailure` 统一委托到此)。
 *
 * - DomainError 且带 i18n 描述 → 用注入的 translator 翻译,落到 `field ?? "form"`;
 * - DomainError 无 i18n(存量过渡) → 直接使用 message;
 * - 其他错误 → `form` + fallback,不把数据库/内部细节透传给客户端。
 *
 * translator 由调用方注入(而非内部取请求 locale),保持纯函数、可在
 * vitest 直接单测;locale 的获取是 action 层的职责。
 */
export function domainFailureWith(
  t: TranslateFn,
  fallback: string,
): (error: unknown) => ActionFailure {
  return (error: unknown) => {
    if (error instanceof DomainError) {
      if (error.i18n) {
        return {
          ok: false,
          errors: { [error.field ?? "form"]: t(error.i18n.key, error.i18n.params) },
        };
      }
      return { ok: false, errors: { [error.field ?? "form"]: error.message } };
    }
    return { ok: false, errors: { form: fallback } };
  };
}
