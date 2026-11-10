import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // The better-auth instance imported by actions.ts is bound to the `db`
  // singleton, which reads DATABASE_URL. Point it at the test database before
  // any module loads so registration writes never touch the dev database.
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

import type { User } from "@open-doing/types";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { accounts, registrationCodes, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { registerAction, type ActionResult } from "./actions";
import {
  generateRegistrationCodes,
  REGISTRATION_CODE_MAX_USES,
} from "./registration-codes";
import { generateNickname, type AuthInput } from "./service";

/**
 * 包装真实 generateUid，默认走真实随机；UID 碰撞用例用
 * mockImplementationOnce 强制返回已存在 UID。
 */
vi.mock("@/lib/uid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uid")>();
  return { ...actual, generateUid: vi.fn(actual.generateUid) };
});

const uidModule = await vi.importActual<typeof import("@/lib/uid")>("@/lib/uid");
const mockGenerateUid = vi.mocked(generateUid);

/**
 * registerAction 现在把请求头传给 better-auth（让限流器看到真实 IP），
 * 单元测试没有 Next.js 请求上下文，这里提供空请求头与 cookie 容器。
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
    "[auth/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("认证注册链路（better-auth）", () => {
  let db: DbClient;
  let code: string;

  beforeEach(async () => {
    db = await setupTestDb();
    mockGenerateUid.mockReset();
    mockGenerateUid.mockImplementation(uidModule.generateUid);
    code = (await generateRegistrationCodes(1, db))[0]!;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /** 注册成功路径：断言 ActionResult 成功并返回领域 User。 */
  async function registerOk(
    input: Partial<AuthInput> & Pick<AuthInput, "username" | "password" | "email">,
  ): Promise<User> {
    const result = await registerAction({
      registrationCode: code,
      ...input,
    } as AuthInput);
    expect(result.ok).toBe(true);
    return (result as Extract<ActionResult<User>, { ok: true }>).data;
  }

  /** 注册失败路径：返回 action 的字段错误映射。 */
  async function registerFail(
    input: Partial<AuthInput> & Pick<AuthInput, "username" | "password">,
  ): Promise<Record<string, string>> {
    const result = await registerAction({
      registrationCode: code,
      email: "fallback@test.com",
      ...input,
    } as AuthInput);
    expect(result.ok).toBe(false);
    return (result as Extract<ActionResult<User>, { ok: false }>).errors;
  }

  async function usedCountOf(value: string): Promise<number> {
    const [row] = await db
      .select({ usedCount: registrationCodes.usedCount })
      .from(registrationCodes)
      .where(eq(registrationCodes.code, value));
    return row!.usedCount;
  }

  it("注册成功：返回领域 User，uid/name/displayUsername/language 按约定落库", async () => {
    const user = await registerOk({
      username: "alice",
      password: "password123",
      email: "alice@example.com",
      gender: "male",
      phone: "+8613800000000",
    });

    expect(user.username).toBe("alice");
    expect(user.uid).toMatch(/^doing_[a-z2-9]{6}$/);
    expect(user.uid.slice("doing_".length)).not.toMatch(/[ilo01]/);
    expect(user.nickname).toBe(generateNickname(user.uid));
    expect(user.gender).toBe("male");
    expect(user.email).toBe("alice@example.com");
    expect(user.phone).toBe("+8613800000000");
    expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      uid: user.uid,
      username: "alice",
      name: generateNickname(user.uid),
      displayUsername: "alice",
      email: "alice@example.com",
      language: "zh",
      gender: "male",
      phone: "+8613800000000",
      emailVerified: false,
    });

    // 密码由 better-auth 写入 accounts 表，绝不明文落库。
    const [account] = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    expect(account!.password).toBeTruthy();
    expect(account!.password).not.toBe("password123");
  });

  it("注册成功消耗注册码的一个名额", async () => {
    await registerOk({ username: "alice", password: "password123", email: "a@test.com" });

    await expect(usedCountOf(code)).resolves.toBe(1);
  });

  it("注册时传入 nickname 时 trim 后作为展示名落库", async () => {
    const user = await registerOk({
      username: "alice",
      password: "password123",
      email: "a@test.com",
      nickname: "  阿岚  ",
    });

    expect(user.nickname).toBe("阿岚");
  });

  it("邮箱小写归一：A@B.com 落库为 a@b.com", async () => {
    const user = await registerOk({
      username: "alice",
      password: "password123",
      email: " A@B.com ",
    });

    expect(user.email).toBe("a@b.com");
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.email).toBe("a@b.com");
  });

  it("用户名大小写敏感：Alice 与 alice 可以并存", async () => {
    await registerOk({ username: "Alice", password: "password123", email: "alice@test.com" });
    await registerOk({ username: "alice", password: "password123", email: "alice2@test.com" });

    const rows = await db.select({ username: users.username }).from(users);
    expect(rows.map((row) => row.username).sort()).toEqual(["Alice", "alice"]);
  });

  it("沿用现有用户名字符语义：允许中文用户名", async () => {
    const user = await registerOk({
      username: "林夏",
      password: "password123",
      email: "cn@test.com",
    });

    expect(user.username).toBe("林夏");
  });

  it("邮箱必填：空邮箱 → email 字段错误", async () => {
    const errors = await registerFail({
      username: "alice",
      password: "password123",
      email: "",
    });

    expect(errors.email).toBe("请输入邮箱");
  });

  it("邮箱格式不合法 → email 字段错误", async () => {
    const errors = await registerFail({
      username: "alice",
      password: "password123",
      email: "not-an-email",
    });

    expect(errors.email).toBe("邮箱格式不正确");
  });

  it("注册码无效 → registrationCode 字段错误，且先于用户名占用检查", async () => {
    await registerOk({ username: "alice", password: "password123", email: "alice@test.com" });

    const result = await registerAction({
      username: "alice",
      password: "password123",
      email: "alice2@test.com",
      registrationCode: "ZZZZZZZZ",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.registrationCode).toBe("注册码无效");
  });

  it("注册码已用尽 → registrationCode 字段错误", async () => {
    await db
      .update(registrationCodes)
      .set({ usedCount: REGISTRATION_CODE_MAX_USES })
      .where(eq(registrationCodes.code, code));

    const errors = await registerFail({ username: "alice", password: "password123" });
    expect(errors.registrationCode).toBe("注册码已达使用上限");
  });

  it("用户名已存在 → username 字段错误", async () => {
    await registerOk({ username: "Alice", password: "password123", email: "a@test.com" });

    const errors = await registerFail({
      username: "Alice",
      password: "password456",
      email: "b@test.com",
    });
    expect(errors.username).toBe("帐号已存在");
  });

  it("邮箱已存在 → email 字段错误", async () => {
    await registerOk({ username: "owner", password: "password123", email: "taken@test.com" });

    const errors = await registerFail({
      username: "second",
      password: "password123",
      email: "taken@test.com",
    });
    expect(errors.email).toBe("邮箱已被使用");
  });

  it("UID 碰撞：中止注册并返回通用错误，不重试", async () => {
    const first = await registerOk({ username: "existing", password: "password123", email: "a@test.com" });

    mockGenerateUid.mockReset();
    mockGenerateUid.mockImplementationOnce(() => first.uid);

    const errors = await registerFail({
      username: "newcomer",
      password: "password123",
      email: "b@test.com",
    });

    expect(mockGenerateUid).toHaveBeenCalledTimes(1);
    expect(errors.form).toBe("系统繁忙，请稍后重试");
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("注册失败（用户名占用 / 资料校验）不消耗注册码名额", async () => {
    await registerOk({ username: "alice", password: "password123", email: "a@test.com" });

    await registerFail({ username: "alice", password: "password456", email: "b@test.com" });
    await expect(usedCountOf(code)).resolves.toBe(1);

    await registerFail({ username: "a", password: "password123", email: "c@test.com" });
    await expect(usedCountOf(code)).resolves.toBe(1);
  });

  it("基础校验：用户名 2–20 字符、密码至少 8 位", async () => {
    const shortUsername = await registerFail({
      username: "a",
      password: "password123",
      email: "a@test.com",
    });
    expect(shortUsername.username).toContain("2–20");

    const longUsername = await registerFail({
      username: "a".repeat(21),
      password: "password123",
      email: "b@test.com",
    });
    expect(longUsername.username).toContain("2–20");

    const shortPassword = await registerFail({
      username: "alice",
      password: "short",
      email: "c@test.com",
    });
    expect(shortPassword.password).toBe("密码至少 8 位");
  });

  it("generateNickname：user_ + 5 位小写十六进制，且结果确定", () => {
    const first = generateNickname("doing_x7k2m9");
    const second = generateNickname("doing_x7k2m9");

    expect(first).toBe(second);
    expect(first).toMatch(/^user_[0-9a-f]{5}$/);
  });
});
