import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { applyActionErrors } from "@/lib/action-form";
import { createTranslator } from "@/i18n/translate";
import zh from "@/i18n/messages/zh.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { RegisterForm, buildRegisterPayload, createRegisterSchema } =
  await import("./RegisterForm");

const tAuthZh = createTranslator(zh.auth);

/** 除 email 外均满足 schema 的表单基线；email 由各用例覆盖。 */
const validRegisterValues = {
  username: "alice",
  password: "secret123",
  confirmPassword: "secret123",
  registrationCode: "ABC123XY",
  nickname: "",
  email: "alice@example.com",
  phone: "",
};

function renderRegisterForm(): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="zh"
      messages={zh}
      now={new Date("2026-11-06T00:00:00.000Z")}
    >
      <RegisterForm />
    </NextIntlClientProvider>,
  );
}

describe("buildRegisterPayload", () => {
  it("submits username/password/email and the trimmed registration code when optional fields are absent", () => {
    expect(
      buildRegisterPayload({
        username: "alice",
        password: "secret123",
        registrationCode: "  ABC123XY  ",
        email: "  alice@example.com  ",
      }),
    ).toStrictEqual({
      username: "alice",
      password: "secret123",
      registrationCode: "ABC123XY",
      email: "alice@example.com",
    });
  });

  it("submits all filled optional fields after trimming", () => {
    expect(
      buildRegisterPayload({
        username: "alice",
        password: "secret123",
        registrationCode: "ABC123XY",
        nickname: "  Alice  ",
        gender: "female",
        email: "  alice@example.com  ",
        phone: "  +8613800138000  ",
      }),
    ).toStrictEqual({
      username: "alice",
      password: "secret123",
      registrationCode: "ABC123XY",
      nickname: "Alice",
      gender: "female",
      email: "alice@example.com",
      phone: "+8613800138000",
    });
  });

  it("submits an empty registration code as-is so the server reports it as required", () => {
    expect(
      buildRegisterPayload({
        username: "alice",
        password: "secret123",
        registrationCode: "   ",
        email: "alice@example.com",
      }),
    ).toStrictEqual({
      username: "alice",
      password: "secret123",
      registrationCode: "",
      email: "alice@example.com",
    });
  });
});

describe("createRegisterSchema email requirement", () => {
  it("reports email as required when the field is empty", () => {
    const result = createRegisterSchema(tAuthZh).safeParse({
      ...validRegisterValues,
      email: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ["email"], message: zh.auth.emailRequired }),
      ]);
    }
  });

  it("treats a whitespace-only email as missing", () => {
    const result = createRegisterSchema(tAuthZh).safeParse({
      ...validRegisterValues,
      email: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ["email"], message: zh.auth.emailRequired }),
      ]);
    }
  });

  it("accepts a valid email so the submit flow proceeds", () => {
    const result = createRegisterSchema(tAuthZh).safeParse(validRegisterValues);

    expect(result.success).toBe(true);
  });

  it("rejects a malformed email with the format message", () => {
    const result = createRegisterSchema(tAuthZh).safeParse({
      ...validRegisterValues,
      email: "not-an-email",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ["email"],
        message: zh.auth.emailInvalid,
      });
    }
  });
});

describe("RegisterForm optional profile fields", () => {
  it("renders the registration code, nickname, gender, email and phone inputs", () => {
    const markup = renderRegisterForm();
    for (const testId of [
      "auth-registration-code-input",
      "auth-nickname-input",
      "auth-gender-male",
      "auth-gender-female",
      "auth-gender-secret",
      "auth-email-input",
      "auth-phone-input",
    ]) {
      expect(markup).toContain(`data-testid="${testId}"`);
    }
    expect(markup).toContain('name="registrationCode"');
    expect(markup).toContain('name="nickname"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('name="phone"');
  });

  it("maps an email server field error onto the email input name", () => {
    const setFieldError = vi.fn();
    const onFormError = vi.fn();

    applyActionErrors(
      { email: "邮箱格式不正确" },
      { setFieldError, onFormError },
    );

    // applyActionErrors 以 action 错误键调用 setFieldError；表单里邮箱输入
    // 由 register("email") 注册，name 与键一致，错误才会落到对应输入框。
    expect(setFieldError).toHaveBeenCalledWith("email", "邮箱格式不正确");
    expect(onFormError).not.toHaveBeenCalled();
    expect(renderRegisterForm()).toContain('name="email"');
  });
});

describe("createRegisterSchema username charset restriction", () => {
  it("rejects a username containing Chinese characters", () => {
    const result = createRegisterSchema(tAuthZh).safeParse({
      ...validRegisterValues,
      username: "张三",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ["username"],
        message: zh.auth.usernameInvalid,
      });
    }
  });

  it("rejects a username mixing ASCII with Chinese", () => {
    const result = createRegisterSchema(tAuthZh).safeParse({
      ...validRegisterValues,
      username: "alice_张三",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ["username"],
        message: zh.auth.usernameInvalid,
      });
    }
  });

  it("accepts ASCII letters, digits and underscores", () => {
    const result = createRegisterSchema(tAuthZh).safeParse({
      ...validRegisterValues,
      username: "alice_01",
    });

    expect(result.success).toBe(true);
  });
});

describe("RegisterForm required-field marks", () => {
  it("marks exactly the five required fields with the red asterisk", () => {
    const markup = renderRegisterForm();

    // 必填：帐号 / 密码 / 确认密码 / 邮箱 / 注册码；选填：昵称、性别、电话。
    expect(markup.match(/data-testid="auth-required-mark"/g)?.length).toBe(5);
  });

  it("does not mark the optional nickname label", () => {
    const markup = renderRegisterForm();
    // 切片窗口只覆盖昵称字段块（到性别分组为止），避免把后续必填项圈进来。
    const nicknameBlock = markup.slice(
      markup.indexOf('id="register-nickname"'),
      markup.indexOf('id="register-gender-label"'),
    );

    expect(nicknameBlock).not.toContain("auth-required-mark");
  });
});
