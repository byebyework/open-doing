import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // better-auth instance / app db singleton read DATABASE_URL before modules
  // load; point it at the test database so actions never touch the dev db.
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

import type { DbClient } from "@/server/db/client";
import { registrationCodes, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { generateRegistrationCodes } from "@/features/auth/registration-codes";
import { auth } from "@/features/auth/server";
import zh from "@/i18n/messages/zh.json";

import {
  createRegistrationCodeAction,
  setUserAdminAction,
  setUserDisabledAction,
} from "./actions";

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

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[admin/actions.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
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

/** 直接走 better-auth 端点注册并拿到会话 cookie。 */
async function signUpCookie(
  registrationCode: string,
  input: { username: string; email: string; name: string },
): Promise<{ id: string; uid: string; cookie: string }> {
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

/** 注册后把 is_admin 置为 true（与 grant flow 落库结果一致）。 */
async function signUpAdmin(
  db: DbClient,
  registrationCode: string,
  input: { username: string; email: string; name: string },
): Promise<{ id: string; cookie: string }> {
  const user = await signUpCookie(registrationCode, input);
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
  return { id: user.id, cookie: user.cookie };
}

function formError(result: { ok: boolean; errors?: Record<string, string> }) {
  return result.ok ? "" : (result.errors?.form ?? "");
}

describe.skipIf(!hasTestDatabase)("admin actions", () => {
  let db: DbClient;
  let code: string;

  beforeEach(async () => {
    db = await setupTestDb();
    code = (await generateRegistrationCodes(1, db))[0]!;
    requestState.cookieHeader = null;
    requestState.written.clear();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("authorization", () => {
    it("returns forbidden for an anonymous caller on all three actions", async () => {
      requestState.cookieHeader = null;

      const create = await createRegistrationCodeAction(10);
      const disable = await setUserDisabledAction(crypto.randomUUID(), true);
      const grant = await setUserAdminAction(crypto.randomUUID(), true);

      for (const result of [create, disable, grant]) {
        expect(result.ok).toBe(false);
        expect(formError(result)).toBe(zh.errors.forbidden);
      }
    });

    it("returns forbidden for a non-admin caller on all three actions", async () => {
      const { cookie } = await signUpCookie(code, {
        username: "alice",
        email: "alice@example.com",
        name: "阿岚",
      });
      requestState.cookieHeader = cookie;

      const create = await createRegistrationCodeAction(10);
      const disable = await setUserDisabledAction(crypto.randomUUID(), true);
      const grant = await setUserAdminAction(crypto.randomUUID(), true);

      for (const result of [create, disable, grant]) {
        expect(result.ok).toBe(false);
        expect(formError(result)).toBe(zh.errors.forbidden);
      }
    });
  });

  describe("createRegistrationCodeAction", () => {
    it("creates a code with the given maxUses for an admin", async () => {
      const { cookie } = await signUpAdmin(db, code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      requestState.cookieHeader = cookie;

      const result = await createRegistrationCodeAction(25);
      expect(result.ok).toBe(true);

      const created = result.ok ? result.data.code : "";
      expect(created).toMatch(/^[A-Z0-9]{8}$/);

      const [row] = await db
        .select({ maxUses: registrationCodes.maxUses })
        .from(registrationCodes)
        .where(eq(registrationCodes.code, created));
      expect(row!.maxUses).toBe(25);
    });

    it("coerces numeric strings from forms into an integer maxUses", async () => {
      const { cookie } = await signUpAdmin(db, code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      requestState.cookieHeader = cookie;

      const result = await createRegistrationCodeAction("7" as unknown as number);
      expect(result.ok).toBe(true);

      const created = result.ok ? result.data.code : "";
      const [row] = await db
        .select({ maxUses: registrationCodes.maxUses })
        .from(registrationCodes)
        .where(eq(registrationCodes.code, created));
      expect(row!.maxUses).toBe(7);
    });

    it("returns a maxUses form error for out-of-range or non-integer input", async () => {
      const { cookie } = await signUpAdmin(db, code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      requestState.cookieHeader = cookie;

      for (const invalid of [0, 1001, Number.NaN, 1.5, "abc"]) {
        const result = await createRegistrationCodeAction(
          invalid as unknown as number,
        );
        expect(result.ok).toBe(false);
        expect(result.ok ? "" : result.errors.maxUses).toBe(zh.admin.adminMaxUsesRange);
      }
    });
  });

  describe("setUserDisabledAction / setUserAdminAction", () => {
    it("surfaces service AdminError keys as translated form errors", async () => {
      const { id, cookie } = await signUpAdmin(db, code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      requestState.cookieHeader = cookie;

      const disableSelf = await setUserDisabledAction(id, true);
      const grantSelf = await setUserAdminAction(id, true);

      for (const result of [disableSelf, grantSelf]) {
        expect(result.ok).toBe(false);
        expect(formError(result)).toBe(zh.admin.selfOperation);
        expect(formError(result)).not.toBe(zh.errors.forbidden);
      }
    });

    it("treats non-UUID target ids as targetNotFound instead of a database error", async () => {
      const { cookie } = await signUpAdmin(db, code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      requestState.cookieHeader = cookie;

      const disable = await setUserDisabledAction("not-a-uuid", true);
      const grant = await setUserAdminAction("not-a-uuid", false);

      for (const result of [disable, grant]) {
        expect(result.ok).toBe(false);
        expect(formError(result)).toBe(zh.admin.targetNotFound);
      }
    });

    it("disables, enables, grants and revokes another user", async () => {
      const { cookie } = await signUpAdmin(db, code, {
        username: "admin",
        email: "admin@example.com",
        name: "管理员",
      });
      const target = await signUpCookie(code, {
        username: "alice",
        email: "alice@example.com",
        name: "阿岚",
      });
      requestState.cookieHeader = cookie;

      await expect(setUserDisabledAction(target.id, true)).resolves.toEqual({
        ok: true,
        data: true,
      });
      expect(
        (
          await db
            .select({ isDisabled: users.isDisabled })
            .from(users)
            .where(eq(users.id, target.id))
        )[0]!.isDisabled,
      ).toBe(true);

      await expect(setUserDisabledAction(target.id, false)).resolves.toEqual({
        ok: true,
        data: true,
      });
      expect(
        (
          await db
            .select({ isDisabled: users.isDisabled })
            .from(users)
            .where(eq(users.id, target.id))
        )[0]!.isDisabled,
      ).toBe(false);

      await expect(setUserAdminAction(target.id, true)).resolves.toEqual({
        ok: true,
        data: true,
      });
      expect(
        (
          await db
            .select({ isAdmin: users.isAdmin })
            .from(users)
            .where(eq(users.id, target.id))
        )[0]!.isAdmin,
      ).toBe(true);

      await expect(setUserAdminAction(target.id, false)).resolves.toEqual({
        ok: true,
        data: true,
      });
      expect(
        (
          await db
            .select({ isAdmin: users.isAdmin })
            .from(users)
            .where(eq(users.id, target.id))
        )[0]!.isAdmin,
      ).toBe(false);
    });
  });
});
