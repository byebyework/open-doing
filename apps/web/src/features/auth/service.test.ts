import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findByUid, getUserById } from "@/features/users/service";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { AuthError, login, registerUser } from "./service";

/**
 * 包装真实 generateUid，默认走真实随机；UID 碰撞用例用
 * mockImplementationOnce 强制先返回已存在 UID、再返回新值。
 */
vi.mock("@/lib/uid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uid")>();
  return { ...actual, generateUid: vi.fn(actual.generateUid) };
});

const uidModule = await vi.importActual<typeof import("@/lib/uid")>("@/lib/uid");
const mockGenerateUid = vi.mocked(generateUid);

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[auth/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=postgres://open-doing:open-doing@localhost:5432/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("认证 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    mockGenerateUid.mockReset();
    mockGenerateUid.mockImplementation(uidModule.generateUid);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("注册成功：返回带 doing_ 前缀 UID 的 User，密码以 argon2id 哈希落库", async () => {
    const user = await registerUser({ username: "alice", password: "password123" });

    expect(user.username).toBe("alice");
    expect(user.uid).toMatch(/^doing_[a-z2-9]{6}$/);
    expect(user.uid.slice("doing_".length)).not.toMatch(/[ilo01]/);
    expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false);

    const row = (await db.select().from(users).where(eq(users.id, user.id)))[0]!;
    expect(row.passwordHash).not.toBe("password123");
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("注册时用户名首尾空白会被裁剪", async () => {
    const user = await registerUser({ username: "  bob  ", password: "password123" });

    expect(user.username).toBe("bob");
  });

  it("用户名重复：抛出「用户名已存在」类错误", async () => {
    await registerUser({ username: "alice", password: "password123" });

    const error = await registerUser({ username: "alice", password: "password456" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "USERNAME_TAKEN",
      field: "username",
      message: "用户名已存在",
    });
  });

  it("UID 碰撞：依赖数据库唯一约束重新生成 UID 后注册成功", async () => {
    const first = await registerUser({ username: "existing", password: "password123" });
    const freshUid = uidModule.generateUid();

    mockGenerateUid.mockReset();
    mockGenerateUid
      .mockImplementationOnce(() => first.uid)
      .mockImplementationOnce(() => freshUid);

    const user = await registerUser({ username: "newcomer", password: "password123" });

    expect(mockGenerateUid).toHaveBeenCalledTimes(2);
    expect(user.uid).toBe(freshUid);
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("注册校验：用户名 2–20 字符、密码至少 8 位", async () => {
    await expect(registerUser({ username: "a", password: "password123" })).rejects.toMatchObject({
      code: "VALIDATION",
      field: "username",
    });
    await expect(
      registerUser({ username: "a".repeat(21), password: "password123" }),
    ).rejects.toMatchObject({ code: "VALIDATION", field: "username" });
    await expect(registerUser({ username: "alice", password: "short" })).rejects.toMatchObject({
      code: "VALIDATION",
      field: "password",
    });
  });

  it("登录成功：正确密码返回 User（不含密码哈希）", async () => {
    const registered = await registerUser({ username: "alice", password: "password123" });

    const loggedIn = await login({ username: "alice", password: "password123" });

    expect(loggedIn).toEqual(registered);
    expect(loggedIn).not.toHaveProperty("passwordHash");
  });

  it("登录失败：错误密码与不存在的用户名抛出同一「用户名或密码错误」", async () => {
    await registerUser({ username: "alice", password: "password123" });

    const wrongPassword = await login({ username: "alice", password: "wrongpass" }).catch(
      (caught: unknown) => caught,
    );
    const missingUser = await login({ username: "nobody", password: "password123" }).catch(
      (caught: unknown) => caught,
    );

    expect(wrongPassword).toBeInstanceOf(AuthError);
    expect(missingUser).toBeInstanceOf(AuthError);
    expect(wrongPassword).toMatchObject({
      code: "INVALID_CREDENTIALS",
      field: "form",
      message: "用户名或密码错误",
    });
    expect(missingUser).toMatchObject({
      code: "INVALID_CREDENTIALS",
      field: "form",
      message: "用户名或密码错误",
    });
  });

  it("users service：按 id / uid 查询返回领域 User，未命中返回 null", async () => {
    const user = await registerUser({ username: "alice", password: "password123" });

    await expect(getUserById(user.id)).resolves.toEqual(user);
    await expect(findByUid(user.uid)).resolves.toEqual(user);
    await expect(getUserById("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
    await expect(findByUid("doing_zzzzzz")).resolves.toBeNull();
  });
});
