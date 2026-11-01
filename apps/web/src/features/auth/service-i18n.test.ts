import { describe, expect, it } from "vitest";

import { AuthError, changePassword, registerUser } from "./service";

/**
 * AuthError 的 i18n 通道（可选第四参）：
 * message 保持 zh 兜底不变，i18n 描述符供 Server Action 按请求语言翻译。
 */
describe("AuthError i18n channel", () => {
  it("携带可选 i18n 描述符；缺省为 undefined", () => {
    const withI18n = new AuthError("VALIDATION", "请输入用户名", "username", {
      key: "usernameRequired",
    });
    expect(withI18n.i18n).toEqual({ key: "usernameRequired" });

    const plain = new AuthError("VALIDATION", "message");
    expect(plain.i18n).toBeUndefined();
  });

  it("注册校验错误携带 auth 命名空间 key 与插值参数", async () => {
    await expect(
      registerUser({ username: "", password: "x".repeat(8) }),
    ).rejects.toMatchObject({
      field: "username",
      i18n: { key: "usernameRequired" },
    });

    await expect(
      registerUser({ username: "a", password: "x".repeat(8) }),
    ).rejects.toMatchObject({
      i18n: { key: "usernameLength", params: { min: 2, max: 20 } },
    });

    await expect(
      registerUser({ username: "alice", password: "short" }),
    ).rejects.toMatchObject({
      i18n: { key: "passwordMinLength", params: { min: 8 } },
    });
  });

  it("修改密码的新密码长度错误携带 key（长度校验先于数据库访问）", async () => {
    await expect(
      changePassword({ userId: "u", oldPassword: "a", newPassword: "short" }),
    ).rejects.toMatchObject({
      field: "newPassword",
      i18n: { key: "newPasswordMinLength", params: { min: 8 } },
    });
  });
});
