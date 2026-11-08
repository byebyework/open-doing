import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { applyActionErrors } from "@/lib/action-form";
import zh from "@/i18n/messages/zh.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { RegisterForm, buildRegisterPayload } = await import("./RegisterForm");

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
  it("submits username/password and the trimmed registration code when optional fields are absent", () => {
    expect(
      buildRegisterPayload({
        username: "alice",
        password: "secret123",
        registrationCode: "  ABC123XY  ",
      }),
    ).toStrictEqual({
      username: "alice",
      password: "secret123",
      registrationCode: "ABC123XY",
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
      }),
    ).toStrictEqual({ username: "alice", password: "secret123", registrationCode: "" });
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
