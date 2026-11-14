import { count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // better-auth instance / app db singleton read DATABASE_URL before modules
  // load; point it at the test database so sessions never touch the dev db.
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

import type { DbClient } from "@/server/db/client";
import { closeTestDb, setupTestDb } from "@/server/db/testing";
import { registrationCodes, sessions, users } from "@/server/db/schema";

import { requireAdmin } from "@/features/admin/guard";

import { changePasswordAction, loginAction } from "./actions";
import {
  generateRegistrationCodes,
} from "./registration-codes";
import { auth } from "./server";
import { getCurrentUser, requireUser } from "./session";

/** 请求级 mock 状态：headers() 返回的 cookie 与 cookies() 写入的 cookie。 */
const requestState = vi.hoisted(() => ({
  cookieHeader: null as string | null,
  written: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const value = new Headers();
    if (requestState.cookieHeader) value.set("cookie", requestState.cookieHeader);
    return value;
  }),
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = requestState.written.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      requestState.written.set(name, value);
    },
    delete: (name: string) => {
      requestState.written.delete(name);
    },
  })),
}));

const redirectState = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: redirectState.redirect,
}));

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[auth/session.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const PASSWORD = "password123";

/** 从 better-auth 响应头中取出 session cookie 的 `name=value` 对。 */
function sessionCookieFrom(headers: Headers): string {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const list = withGetSetCookie.getSetCookie
    ? withGetSetCookie.getSetCookie()
    : [headers.get("set-cookie") ?? ""];

  for (const raw of list) {
    const match = raw.match(/((?:__Secure-)?better-auth\.session_token)=([^;]+)/);
    if (match) return `${match[1]}=${match[2]}`;
  }

  throw new Error("better-auth 响应中没有 session cookie");
}

/** 直接走 better-auth 端点注册并拿到 Set-Cookie（invite code 由调用方准备）。 */
async function signUpCookie(
  registrationCode: string,
  input: { username: string; email: string; name: string },
): Promise<{ id: string; uid: string; cookie: string }> {
  // 变量形式保留 username / registrationCode 等插件/钩子字段，避免对象字面量
  // 触发多余属性检查（与 registerAction 的写法一致）。
  const body = {
    ...input,
    password: PASSWORD,
    registrationCode,
  };
  const result = await auth.api.signUpEmail({ body, returnHeaders: true });

  return {
    id: result.response.user.id,
    uid: result.response.user.uid ?? "",
    cookie: sessionCookieFrom(result.headers),
  };
}

/** 直接走 better-auth 登录端点拿到的 session cookie。 */
async function signInCookie(username: string, password = PASSWORD): Promise<string> {
  const result = await auth.api.signInUsername({
    body: { username, password },
    returnHeaders: true,
  });
  return sessionCookieFrom(result.headers);
}

describe.skipIf(!hasTestDatabase)("better-auth 会话", () => {
  let db: DbClient;
  let code: string;

  beforeEach(async () => {
    db = await setupTestDb();
    code = (await generateRegistrationCodes(1, db))[0]!;
    requestState.cookieHeader = null;
    requestState.written.clear();
    redirectState.redirect.mockReset();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("注册后的 session cookie 可被 getCurrentUser 识别（register → redirect 保持登录）", async () => {
    const { id, uid, cookie } = await signUpCookie(code, {
      username: "alice",
      email: "alice@example.com",
      name: "阿岚",
    });

    // 注册端点下发的 Set-Cookie 正是 nextCookies 在 Server Action 中写给
    // 浏览器的 cookie；下一个请求带上它，getCurrentUser 必须返回完整用户。
    requestState.cookieHeader = cookie;
    const user = await getCurrentUser();

    expect(user).toMatchObject({
      id,
      uid,
      username: "alice",
      nickname: "阿岚",
      gender: null,
      email: "alice@example.com",
      phone: null,
      // Task 3 的 additionalFields 必须真正进入会话用户；若 better-auth 静默丢弃
      // 这两个字段，管理台守卫会永久放行/误拒，故在此显式断言。
      isAdmin: false,
      isDisabled: false,
    });
    expect(Number.isNaN(Date.parse(user!.createdAt))).toBe(false);

    const [row] = await db
      .select({ language: users.language, registrationCodeId: users.registrationCodeId })
      .from(users)
      .where(eq(users.id, id));
    expect(row!.language).toBe("zh");

    // 注册钩子消费的码 id 必须落到 users.registration_code_id（管理台使用者列表）。
    const [codeRow] = await db
      .select({ id: registrationCodes.id })
      .from(registrationCodes)
      .where(eq(registrationCodes.code, code));
    expect(row!.registrationCodeId).toBe(codeRow!.id);
  });

  it("无 cookie 时 getCurrentUser 返回 null", async () => {
    requestState.cookieHeader = null;
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("伪造 / 过期 cookie 返回 null（校验落在 sessions 表，而非签名本身）", async () => {
    const { id, cookie } = await signUpCookie(code, {
      username: "alice",
      email: "alice@example.com",
      name: "阿岚",
    });

    requestState.cookieHeader =
      "better-auth.session_token=forged-token.not-a-valid-signature";
    await expect(getCurrentUser()).resolves.toBeNull();

    // 将库中会话标记为过期：签名仍有效，但按 session.expiresAt 校验失败。
    const token = cookie.slice("better-auth.session_token=".length, cookie.lastIndexOf("."));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.token, token));

    requestState.cookieHeader = cookie;
    await expect(getCurrentUser()).resolves.toBeNull();

    // better-auth 会顺手删除过期会话行；无论是否删除，getCurrentUser 都已
    // 不会再返回该用户。
    const expired = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.userId, id));
    expect(expired).toEqual([]);
  });

  it("loginAction 走 better-auth：成功返回领域 User，失败统一 invalidCredentials", async () => {
    await signUpCookie(code, {
      username: "alice",
      email: "alice@example.com",
      name: "阿岚",
    });

    requestState.cookieHeader = null;
    const ok = await loginAction({ username: "alice", password: PASSWORD });
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.data).toMatchObject({ username: "alice", nickname: "阿岚" });

    const wrong = await loginAction({ username: "alice", password: "wrong-password" });
    expect(wrong).toEqual({ ok: false, errors: { form: "帐号或密码错误" } });

    const unknown = await loginAction({ username: "nobody", password: PASSWORD });
    expect(unknown).toEqual({ ok: false, errors: { form: "帐号或密码错误" } });
  });

  it("changePasswordAction 撤销其他会话：旧 cookie 全部失效，当前设备拿到新会话", async () => {
    const { id } = await signUpCookie(code, {
      username: "alice",
      email: "alice@example.com",
      name: "阿岚",
    });
    // 注册本身已产生一个会话；再登录一次得到第二个会话。
    const cookieA = await signInCookie("alice");
    const cookieB = await signInCookie("alice");
    expect(await db.select({ total: count() }).from(sessions)).toEqual([{ total: 3 }]);

    requestState.cookieHeader = cookieA;
    await expect(getCurrentUser()).resolves.not.toBeNull();

    const result = await changePasswordAction({
      oldPassword: PASSWORD,
      newPassword: "new-password-456",
    });
    expect(result).toEqual({ ok: true, data: true });

    // revokeOtherSessions 删除全部旧行并创建 1 个新会话。
    expect((await db.select({ total: count() }).from(sessions))[0]!.total).toBe(1);
    expect(
      (await db.select({ userId: sessions.userId }).from(sessions))[0]!.userId,
    ).toBe(id);

    requestState.cookieHeader = cookieA;
    await expect(getCurrentUser()).resolves.toBeNull();

    requestState.cookieHeader = cookieB;
    await expect(getCurrentUser()).resolves.toBeNull();

    // 新密码生效、旧密码失效。
    await expect(signInCookie("alice", "new-password-456")).resolves.toContain(
      "better-auth.session_token=",
    );
    await expect(signInCookie("alice", PASSWORD)).rejects.toBeTruthy();
  });

  it("改密失败映射：旧密码错误落 oldPassword，新密码过短落 newPassword", async () => {
    const { cookie } = await signUpCookie(code, {
      username: "alice",
      email: "alice@example.com",
      name: "阿岚",
    });

    requestState.cookieHeader = cookie;
    const wrongOld = await changePasswordAction({
      oldPassword: "not-the-password",
      newPassword: "new-password-456",
    });
    expect(wrongOld).toEqual({ ok: false, errors: { oldPassword: "旧密码不正确" } });

    const tooShort = await changePasswordAction({
      oldPassword: PASSWORD,
      newPassword: "short",
    });
    expect(tooShort).toEqual({ ok: false, errors: { newPassword: "密码至少 8 位" } });

    // 字节上限预检（2026-11-14）：73 字符 = 73 字节 > 72，在调用
    // better-auth 之前由 action 拦截，落 newPassword 字段。
    const tooLong = await changePasswordAction({
      oldPassword: PASSWORD,
      newPassword: "a".repeat(73),
    });
    expect(tooLong).toEqual({ ok: false, errors: { newPassword: "密码过长" } });
  });

  it("未登录时 requireUser 重定向到 /login", async () => {
    requestState.cookieHeader = null;

    await requireUser();

    expect(redirectState.redirect).toHaveBeenCalledWith("/login");
  });

  describe("disabled session enforcement", () => {
    it("getCurrentUser clears all sessions and returns null for a disabled user", async () => {
      const { id, cookie } = await signUpCookie(code, {
        username: "alice",
        email: "alice@example.com",
        name: "阿岚",
      });
      // 再登录一次，确认清除覆盖该用户的「全部」会话，而不只是当前 cookie。
      const secondCookie = await signInCookie("alice");
      await db.update(users).set({ isDisabled: true }).where(eq(users.id, id));

      requestState.cookieHeader = cookie;
      await expect(getCurrentUser()).resolves.toBeNull();

      // 库存会话必须清空：即便旧 cookie 仍在客户端，也无法再次通过校验。
      expect(
        await db
          .select({ userId: sessions.userId })
          .from(sessions)
          .where(eq(sessions.userId, id)),
      ).toEqual([]);

      requestState.cookieHeader = secondCookie;
      await expect(getCurrentUser()).resolves.toBeNull();
    });

    it("returns null when no session cookie is present", async () => {
      requestState.cookieHeader = null;
      await expect(getCurrentUser()).resolves.toBeNull();
    });
  });

  describe("requireAdmin guard", () => {
    beforeEach(() => {
      // 真实 next/navigation 的 redirect() 以抛出 NEXT_REDIRECT 结束控制流；
      // mock 必须复刻该语义，否则 null 分支会在后续 user.isAdmin 上崩溃。
      redirectState.redirect.mockImplementation((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
    });

    it("redirects anonymous visitors to /login", async () => {
      requestState.cookieHeader = null;

      await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(redirectState.redirect).toHaveBeenCalledWith("/login");
    });

    it("redirects non-admin users to the personal dashboard", async () => {
      const { cookie } = await signUpCookie(code, {
        username: "alice",
        email: "alice@example.com",
        name: "阿岚",
      });
      requestState.cookieHeader = cookie;

      await expect(requireAdmin()).rejects.toThrow(
        "NEXT_REDIRECT:/space/personal/dashboard",
      );
      expect(redirectState.redirect).toHaveBeenCalledWith("/space/personal/dashboard");
    });

    it("returns the admin user and never redirects", async () => {
      const { id, uid, cookie } = await signUpCookie(code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, id));
      requestState.cookieHeader = cookie;

      const user = await requireAdmin();

      expect(user).toMatchObject({ id, uid, username: "admin", isAdmin: true });
      expect(redirectState.redirect).not.toHaveBeenCalled();
    });
  });
});
