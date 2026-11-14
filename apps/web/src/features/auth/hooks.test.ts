import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // better-auth instance / app db singleton read DATABASE_URL before modules
  // load; point it at the test database so hooks never touch the dev db.
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

import type { DbClient } from "@/server/db/client";
import { closeTestDb, setupTestDb } from "@/server/db/testing";
import { registrationCodes, users } from "@/server/db/schema";

import { generateRegistrationCodes } from "./registration-codes";
import { auth } from "./server";

/**
 * better-auth 的 nextCookies 插件在 Server Action 之外也会调用 next/headers；
 * 测试里提供一个无状态 mock（与 session.test.ts 的 request mock 同构）。
 */
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[auth/hooks.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const PASSWORD = "password123";

describe.skipIf(!hasTestDatabase)("disabled account sign-in", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects login for a disabled user via the sign-in/username hook", async () => {
    // 直接库内造一个 is_disabled 用户（不经 UI）。
    await db.insert(users).values({
      id: randomUUID(),
      uid: "doing_t1e2s3t4",
      username: "disabled_user",
      displayUsername: "disabled_user",
      name: "D",
      email: "disabled@test.local",
      isDisabled: true,
    });

    await expect(
      auth.api.signInUsername({
        body: { username: "disabled_user", password: "x" },
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_DISABLED" } });
  });

  it("persists registration_code_id at sign-up", async () => {
    const code = (await generateRegistrationCodes(1, db))[0]!;

    const body = {
      email: "hookuser@example.com",
      password: PASSWORD,
      name: "钩子用户",
      username: "hookuser",
      registrationCode: code,
    };
    await auth.api.signUpEmail({ body });

    const [codeRow] = await db
      .select({ id: registrationCodes.id })
      .from(registrationCodes)
      .where(eq(registrationCodes.code, code));
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.username, "hookuser"));
    expect(row!.registrationCodeId).toBe(codeRow!.id);
  });
});
