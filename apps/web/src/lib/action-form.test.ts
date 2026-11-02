import { describe, expect, it, vi } from "vitest";

import { applyActionErrors } from "./action-form";

describe("applyActionErrors", () => {
  it("routes field errors to setFieldError and form error to onFormError", () => {
    const setFieldError = vi.fn();
    const onFormError = vi.fn();
    const applied = applyActionErrors(
      { form: "登录失败,请重试", username: "用户名或密码错误", password: undefined },
      { setFieldError, onFormError },
    );
    expect(applied).toBe(true);
    expect(setFieldError).toHaveBeenCalledWith("username", "用户名或密码错误");
    expect(setFieldError).not.toHaveBeenCalledWith("password", expect.anything());
    expect(onFormError).toHaveBeenCalledWith("登录失败,请重试");
  });

  it("returns false when there is nothing to apply", () => {
    const setFieldError = vi.fn();
    const onFormError = vi.fn();
    expect(applyActionErrors({}, { setFieldError, onFormError })).toBe(false);
    expect(setFieldError).not.toHaveBeenCalled();
    expect(onFormError).not.toHaveBeenCalled();
  });
});
