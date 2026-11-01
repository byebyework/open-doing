import { describe, expect, it } from "vitest";

import type { TranslateFn } from "@/i18n/translate";

import { standardFailures } from "./action-failure";

const fakeT: TranslateFn = (key, values) => {
  const routes: Record<string, string> = {
    "errors.notLoggedIn": "请先登录",
    "errors.forbidden": "没有权限执行该操作",
    "errors.operationFailed": "操作失败，请稍后重试",
    "errors.teamForbidden": "没有权限查看该团队",
    "settings.saveFailed": "设置保存失败，请稍后重试",
  };
  const template = routes[key];
  if (template === undefined) throw new Error(`missing key: ${key}`);
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_m, n: string) =>
    values[n] === undefined ? `{${n}}` : String(values[n]),
  );
};

describe("standardFailures", () => {
  const failures = standardFailures(fakeT);

  it("notLoggedIn 返回 errors.notLoggedIn 翻译值,落到 form", () => {
    expect(failures.notLoggedIn()).toEqual({
      ok: false,
      errors: { form: "请先登录" },
    });
  });

  it("forbidden 返回 errors.forbidden 翻译值", () => {
    expect(failures.forbidden()).toEqual({
      ok: false,
      errors: { form: "没有权限执行该操作" },
    });
  });

  it("unexpected 返回 errors.operationFailed 翻译值,不吞错误栈(日志由调用方负责)", () => {
    expect(failures.unexpected()).toEqual({
      ok: false,
      errors: { form: "操作失败，请稍后重试" },
    });
  });

  it("自定义文案走同一 translator(如团队无权限、设置保存失败)", () => {
    expect(failures.custom("errors.teamForbidden")).toEqual({
      ok: false,
      errors: { form: "没有权限查看该团队" },
    });
    expect(failures.custom("settings.saveFailed")).toEqual({
      ok: false,
      errors: { form: "设置保存失败，请稍后重试" },
    });
  });
});
