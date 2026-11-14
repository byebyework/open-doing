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

describe("validateRegistration 密码字节上限与邮箱长度", () => {
  const base = {
    username: "alice",
    password: "password123",
    email: "alice@test.com",
  };

  it("注册密码 73 个 ASCII 字符（73 字节）→ auth.passwordTooLong", () => {
    try {
      validateRegistration({ ...base, password: "a".repeat(73) });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).i18n).toEqual({ key: "passwordTooLong" });
    }
  });

  it("注册密码 25 个汉字（75 字节）→ 同样拒绝（字节口径）", () => {
    try {
      validateRegistration({ ...base, password: "密".repeat(25) });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AuthError).i18n).toEqual({ key: "passwordTooLong" });
    }
  });

  it("注册密码 72 个 ASCII 字符（72 字节）通过", () => {
    expect(() =>
      validateRegistration({ ...base, password: "a".repeat(72) }),
    ).not.toThrow();
  });

  it("注册邮箱 255 字符 → auth.emailTooLong；254 通过", () => {
    // "a".repeat(246) + "@test.com"（9 字符）= 255
    try {
      validateRegistration({ ...base, email: "a".repeat(246) + "@test.com" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AuthError).i18n).toEqual({ key: "emailTooLong" });
    }
    // 245 + 9 = 254，边界通过
    expect(() =>
      validateRegistration({ ...base, email: "a".repeat(245) + "@test.com" }),
    ).not.toThrow();
  });
});
