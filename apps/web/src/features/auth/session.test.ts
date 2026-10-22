import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE,
  signSessionToken,
  verifySessionToken,
} from "./session";

/** 测试用密钥，显式传入以避免依赖进程环境变量。 */
const secretA = new TextEncoder().encode("session-test-secret-a-0123456789");
const secretB = new TextEncoder().encode("session-test-secret-b-0123456789");

describe("jose 无状态会话", () => {
  it("签名 / 验签往返后返回 userId", async () => {
    const token = await signSessionToken("user-1", secretA);

    await expect(verifySessionToken(token, secretA)).resolves.toBe("user-1");
  });

  it("token 的 exp - iat 等于 30 天", async () => {
    const token = await signSessionToken("user-1", secretA);
    const { payload } = await jwtVerify(token, secretA, { algorithms: ["HS256"] });

    expect(payload.userId).toBe("user-1");
    expect(payload.exp! - payload.iat!).toBe(SESSION_MAX_AGE);
  });

  it("用不同 secret 伪造的 token 验签失败", async () => {
    const forged = await signSessionToken("attacker", secretB);

    await expect(verifySessionToken(forged, secretA)).rejects.toThrow();
  });

  it("被篡改的 token 验签失败", async () => {
    const token = await signSessionToken("user-1", secretA);
    const tampered = `${token.slice(0, -2)}xy`;

    await expect(verifySessionToken(tampered, secretA)).rejects.toThrow();
  });

  it("cookie 属性常量为 httpOnly + lax + 30 天 + 根路径", () => {
    expect(SESSION_COOKIE_NAME).toBe("od_session");
    expect(SESSION_MAX_AGE).toBe(60 * 60 * 24 * 30);
    expect(SESSION_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    // 测试环境不是 production，secure 关闭；生产构建由 NODE_ENV 打开。
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(false);
  });
});
