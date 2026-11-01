import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error";
import { domainFailureWith } from "./domain-failure";
import type { TranslateFn } from "@/i18n/translate";

/** 按记录回放的假 translator:未登记的 key 抛错(与真实现同语义)。 */
function fakeT(routes: Record<string, string>): TranslateFn {
  return (key, values) => {
    const template = routes[key];
    if (template === undefined) {
      throw new Error(`[i18n] missing key: ${key}`);
    }
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) =>
      values[name] === undefined ? `{${name}}` : String(values[name]),
    );
  };
}

describe("domainFailureWith", () => {
  const fail = domainFailureWith(
    fakeT({
      "errors.forbidden": "没有权限执行该操作",
      "errors.titleTooLong": "「{label}」标题不能超过 {max} 个字符",
    }),
    "unexpected error",
  );

  it("带 i18n 的 DomainError：用 t 翻译并按 field 映射", () => {
    const error = new DomainError("errors.forbidden", undefined, {
      key: "errors.forbidden",
    });
    expect(fail(error)).toEqual({
      ok: false,
      errors: { form: "没有权限执行该操作" },
    });
  });

  it("带 i18n 参数的 DomainError：插值传参且落到指定 field", () => {
    const error = new DomainError("errors.titleTooLong", "title", {
      key: "errors.titleTooLong",
      params: { label: "任务", max: 200 },
    });
    expect(fail(error)).toEqual({
      ok: false,
      errors: { title: "「任务」标题不能超过 200 个字符" },
    });
  });

  it("无 i18n 的 DomainError（存量路径）：直接使用 message", () => {
    const error = new DomainError("旧格式错误文案", "name");
    expect(fail(error)).toEqual({
      ok: false,
      errors: { name: "旧格式错误文案" },
    });
  });

  it("未知错误：兜底到 form + fallback，不泄露内部细节", () => {
    const error = new Error("db connection refused");
    expect(fail(error)).toEqual({
      ok: false,
      errors: { form: "unexpected error" },
    });
  });
});
