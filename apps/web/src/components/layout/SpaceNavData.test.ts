import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // better-auth 实例 / app db 单例在模块加载前读 DATABASE_URL；
  // 指向测试库，避免触碰开发库（同 session.test.ts 约定）。
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

import { auth } from "@/features/auth/server";
import { generateRegistrationCodes } from "@/features/auth/registration-codes";
import { type DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { getSpaceNavData } from "./SpaceNavData";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

/** 请求级 mock：headers() 返回的 cookie。 */
const requestState = vi.hoisted(() => ({
  cookieHeader: null as string | null,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    const value = new Headers();
    if (requestState.cookieHeader) value.set("cookie", requestState.cookieHeader);
    return value;
  }),
}));

const PASSWORD = "password123";

/** 从 better-auth 响应头中取出 session cookie 的 `name=value` 对（同 session.test.ts）。 */
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

/** 走真实注册流程（better-auth 端点）拿用户与签名会话 cookie。 */
async function signUpCookie(
  db: DbClient,
  registrationCode: string,
): Promise<{ id: string; username: string; cookie: string }> {
  const username = `nav_${randomUUID().slice(0, 8)}`;
  const body = {
    username,
    email: `${username}@nav.test`,
    name: "导航用户",
    password: PASSWORD,
    registrationCode,
  };
  const result = await auth.api.signUpEmail({ body, returnHeaders: true });
  return {
    id: result.response.user.id,
    username,
    cookie: sessionCookieFrom(result.headers),
  };
}

describe.skipIf(!hasTestDatabase)("getSpaceNavData", () => {
  let db: DbClient;
  let code: string;

  beforeEach(async () => {
    db = await setupTestDb();
    code = (await generateRegistrationCodes(1, db))[0]!;
    requestState.cookieHeader = null;
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("returns loggedIn:false without a session cookie", async () => {
    const data = await getSpaceNavData();
    expect(data.loggedIn).toBe(false);
    expect(data.isAdmin).toBe(false);
  });

  it("returns isAdmin:false for a regular user", async () => {
    const { username, cookie } = await signUpCookie(db, code);
    requestState.cookieHeader = cookie;
    const data = await getSpaceNavData();
    expect(data.loggedIn).toBe(true);
    expect(data.isAdmin).toBe(false);
  });

  it("returns isAdmin:true for an admin user", async () => {
    const { id, cookie } = await signUpCookie(db, code);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, id));
    requestState.cookieHeader = cookie;
    const data = await getSpaceNavData();
    expect(data.loggedIn).toBe(true);
    expect(data.isAdmin).toBe(true);
  });
});
