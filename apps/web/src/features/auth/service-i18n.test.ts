import { describe, expect, it } from "vitest";

import { registerAction } from "./actions";
import { AuthError } from "./service";

/**
 * AuthError 的 i18n 通道（可选第四参）：
 * message 保持 zh 兜底不变，i18n 描述符供 Server Action 按请求语言翻译。
 */
describe("AuthError i18n channel", () => {
  it("携带可选 i18n 描述符；缺省为 undefined", () => {
    const withI18n = new AuthError("VALIDATION", "请输入帐号", "username", {
      key: "usernameRequired",
    });
    expect(withI18n.i18n).toEqual({ key: "usernameRequired" });

    const plain = new AuthError("VALIDATION", "message");
    expect(plain.i18n).toBeUndefined();
  });

  it("注册码校验先于资料校验与任何数据库访问，缺码报 auth.registrationCodeRequired", async () => {
    const result = await registerAction({
      username: "",
      password: "x".repeat(8),
      email: "a@test.com",
    });
    expect(result).toEqual({
      ok: false,
      errors: { registrationCode: "请输入注册码" },
    });
  });
});
