import { describe, expect, it } from "vitest";

import { registerAction } from "./actions";
import { AuthError, validateRegistration } from "./service";

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

describe("validateRegistration username charset", () => {
  const base = {
    username: "alice",
    password: "password123",
    email: "alice@test.com",
  };

  it("拒绝包含中文的帐号（i18n key: usernameInvalid）", () => {
    try {
      validateRegistration({ ...base, username: "张三" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).i18n).toEqual({ key: "usernameInvalid" });
    }
  });

  it("拒绝 ASCII 与中文混排的帐号", () => {
    try {
      validateRegistration({ ...base, username: "alice_张三" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AuthError).i18n).toEqual({ key: "usernameInvalid" });
    }
  });

  it("接受字母、数字、下划线组成的帐号", () => {
    const result = validateRegistration({
      ...base,
      username: "alice_01",
    });
    expect(result.username).toBe("alice_01");
  });
});
