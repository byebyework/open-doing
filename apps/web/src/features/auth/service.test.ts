import { verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findByUid, getCredentialsByUsername, getUserById } from "@/features/users/service";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { registrationCodes, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { generateRegistrationCodes, REGISTRATION_CODE_MAX_USES } from "./registration-codes";
import {
  AuthError,
  changePassword,
  generateNickname,
  login,
  registerUser,
  type AuthInput,
} from "./service";

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
    "[auth/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=mysql://open-doing:open-doing@localhost:3307/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("认证 service", () => {
  let db: DbClient;
  let code: string;

  beforeEach(async () => {
    db = await setupTestDb();
    mockGenerateUid.mockReset();
    mockGenerateUid.mockImplementation(uidModule.generateUid);
    // 封测注册码：每个用例预置一个有效码，供 registerWithCode 注入。
    code = (await generateRegistrationCodes(1, db))[0]!;
  });

  /** 注册码封测后注册必须凭码；默认注入当前用例的有效码。 */
  const registerWithCode = (
    input: Omit<AuthInput, "registrationCode"> & { registrationCode?: string },
    client: DbClient = db,
  ) => registerUser({ registrationCode: code, ...input }, client);

  async function usedCountOf(value: string): Promise<number> {
    const [row] = await db
      .select({ usedCount: registrationCodes.usedCount })
      .from(registrationCodes)
      .where(eq(registrationCodes.code, value));
    return row!.usedCount;
  }

  afterAll(async () => {
    await closeTestDb();
  });

  it("注册成功：返回带 doing_ 前缀 UID 的 User，密码以 argon2id 哈希落库", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    expect(user.username).toBe("alice");
    expect(user.uid).toMatch(/^doing_[a-z2-9]{6}$/);
    expect(user.uid.slice("doing_".length)).not.toMatch(/[ilo01]/);
    expect(Number.isNaN(Date.parse(user.createdAt))).toBe(false);

    const row = (await db.select().from(users).where(eq(users.id, user.id)))[0]!;
    expect(row.passwordHash).not.toBe("password123");
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("注册时用户名首尾空白会被裁剪", async () => {
    const user = await registerWithCode({ username: "  bob  ", password: "password123" }, db);

    expect(user.username).toBe("bob");
  });

  it("用户名重复：抛出「用户名已存在」类错误", async () => {
    await registerWithCode({ username: "alice", password: "password123" }, db);

    const error = await registerWithCode({ username: "alice", password: "password456" }, db).catch(
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
    const first = await registerWithCode({ username: "existing", password: "password123" }, db);
    const freshUid = uidModule.generateUid();

    mockGenerateUid.mockReset();
    mockGenerateUid
      .mockImplementationOnce(() => first.uid)
      .mockImplementationOnce(() => freshUid);

    const user = await registerWithCode({ username: "newcomer", password: "password123" }, db);

    expect(mockGenerateUid).toHaveBeenCalledTimes(2);
    expect(user.uid).toBe(freshUid);
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("注册校验：用户名 2–20 字符、密码至少 8 位", async () => {
    await expect(registerWithCode({ username: "a", password: "password123" }, db)).rejects.toMatchObject({
      code: "VALIDATION",
      field: "username",
    });
    await expect(
      registerWithCode({ username: "a".repeat(21), password: "password123" }, db),
    ).rejects.toMatchObject({ code: "VALIDATION", field: "username" });
    await expect(registerWithCode({ username: "alice", password: "short" }, db)).rejects.toMatchObject({
      code: "VALIDATION",
      field: "password",
    });
  });

  describe("注册资料字段", () => {
    it("email / phone 传空字符串时落库为 null", async () => {
      const user = await registerWithCode(
        { username: "alice", password: "password123", email: "", phone: "" },
        db,
      );

      expect(user.email).toBeNull();
      expect(user.phone).toBeNull();
    });

    it("email 会 trim 并转为小写", async () => {
      const user = await registerWithCode(
        { username: "alice", password: "password123", email: "A@B.COM " },
        db,
      );

      expect(user.email).toBe("a@b.com");
    });

    it("非法 gender：VALIDATION / field gender / key genderInvalid", async () => {
      const error = await registerWithCode(
        { username: "alice", password: "password123", gender: "other" },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "VALIDATION",
        field: "gender",
        i18n: { key: "genderInvalid" },
      });
    });

    it("非法 phone：VALIDATION / field phone / key phoneInvalid", async () => {
      const error = await registerWithCode(
        { username: "alice", password: "password123", phone: "123" },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "VALIDATION",
        field: "phone",
        i18n: { key: "phoneInvalid" },
      });
    });

    it("非法 email：VALIDATION / field email / key emailInvalid", async () => {
      const error = await registerWithCode(
        { username: "alice", password: "password123", email: "not-an-email" },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "VALIDATION",
        field: "email",
        i18n: { key: "emailInvalid" },
      });
    });

    it("nickname 超过 50 字符：VALIDATION / field nickname / key nicknameMaxLength", async () => {
      const error = await registerWithCode(
        { username: "alice", password: "password123", nickname: "x".repeat(51) },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "VALIDATION",
        field: "nickname",
        i18n: { key: "nicknameMaxLength" },
      });
    });

    it("未传 nickname 时按 uid 生成默认昵称", async () => {
      const user = await registerWithCode({ username: "alice", password: "password123" }, db);

      expect(user.nickname).toBe(generateNickname(user.uid));
    });

    it("传入 nickname 时 trim 后作为昵称落库", async () => {
      const user = await registerWithCode(
        { username: "alice", password: "password123", nickname: "  阿岚  " },
        db,
      );

      expect(user.nickname).toBe("阿岚");
    });

    it("邮箱重复：抛出 EMAIL_TAKEN 字段错误，而不是 UID_GENERATION_FAILED", async () => {
      await registerWithCode(
        { username: "owner", password: "password123", email: "taken@test.com" },
        db,
      );

      const error = await registerWithCode(
        { username: "second", password: "password123", email: "taken@test.com" },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "EMAIL_TAKEN",
        field: "email",
        i18n: { key: "emailTaken" },
      });
      expect((error as AuthError).code).not.toBe("UID_GENERATION_FAILED");
    });

    it("手机号重复：抛出 PHONE_TAKEN 字段错误，而不是 UID_GENERATION_FAILED", async () => {
      await registerWithCode(
        { username: "owner", password: "password123", phone: "+8613800000000" },
        db,
      );

      const error = await registerWithCode(
        { username: "second", password: "password123", phone: "+8613800000000" },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "PHONE_TAKEN",
        field: "phone",
        i18n: { key: "phoneTaken" },
      });
      expect((error as AuthError).code).not.toBe("UID_GENERATION_FAILED");
    });

    it("generateNickname：user_ + 5 位小写十六进制，且结果确定", () => {
      const first = generateNickname("doing_x7k2m9");
      const second = generateNickname("doing_x7k2m9");

      expect(first).toBe(second);
      expect(first).toMatch(/^user_[0-9a-f]{5}$/);
    });
  });

  describe("注册码", () => {
    it("未提供注册码：VALIDATION / field registrationCode / key registrationCodeRequired", async () => {
      const error = await registerUser({ username: "alice", password: "password123" }, db).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "VALIDATION",
        field: "registrationCode",
        i18n: { key: "registrationCodeRequired" },
      });
      expect(await db.select().from(registrationCodes)).toHaveLength(1);
    });

    it("码不存在：REGISTRATION_CODE_INVALID / key registrationCodeInvalid，且先于用户名占用检查", async () => {
      // 先注册 alice 占用用户名：无有效码的请求只应看到「码无效」，不泄露占用信息。
      await registerWithCode({ username: "alice", password: "password123" }, db);

      const error = await registerUser(
        { username: "alice", password: "password123", registrationCode: "ZZZZZZZZ" },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "REGISTRATION_CODE_INVALID",
        field: "registrationCode",
        i18n: { key: "registrationCodeInvalid" },
      });
    });

    it("码已用尽：REGISTRATION_CODE_EXHAUSTED / key registrationCodeExhausted", async () => {
      await db
        .update(registrationCodes)
        .set({ usedCount: REGISTRATION_CODE_MAX_USES })
        .where(eq(registrationCodes.code, code));

      const error = await registerWithCode({ username: "alice", password: "password123" }, db).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code: "REGISTRATION_CODE_EXHAUSTED",
        field: "registrationCode",
        i18n: { key: "registrationCodeExhausted" },
      });
    });

    it("注册成功：消耗码的一个名额", async () => {
      await registerWithCode({ username: "alice", password: "password123" }, db);

      await expect(usedCountOf(code)).resolves.toBe(1);
    });

    it("注册失败（用户名重复）：回滚，不消耗名额", async () => {
      await registerWithCode({ username: "alice", password: "password123" }, db);

      await expect(
        registerWithCode({ username: "alice", password: "password456" }, db),
      ).rejects.toMatchObject({ code: "USERNAME_TAKEN" });

      await expect(usedCountOf(code)).resolves.toBe(1);
    });

    it("注册失败（资料校验）：回滚，不消耗名额", async () => {
      await expect(
        registerWithCode({ username: "a", password: "password123" }, db),
      ).rejects.toMatchObject({ code: "VALIDATION", field: "username" });

      await expect(usedCountOf(code)).resolves.toBe(0);
    });
  });

  it("登录成功：正确密码返回 User（不含密码哈希）", async () => {
    const registered = await registerWithCode({ username: "alice", password: "password123" }, db);

    const loggedIn = await login({ username: "alice", password: "password123" }, db);

    expect(loggedIn).toEqual(registered);
    expect(loggedIn).not.toHaveProperty("passwordHash");
  });

  it("登录失败：错误密码与不存在的用户名抛出同一「用户名或密码错误」", async () => {
    await registerWithCode({ username: "alice", password: "password123" }, db);

    const wrongPassword = await login({ username: "alice", password: "wrongpass" }, db).catch(
      (caught: unknown) => caught,
    );
    const missingUser = await login({ username: "nobody", password: "password123" }, db).catch(
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

  it("修改密码成功：返回 true，新密码可验证、旧密码失效", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    await expect(
      changePassword(
        { userId: user.id, oldPassword: "password123", newPassword: "newpassword456" },
        db,
      ),
    ).resolves.toBe(true);

    const credentials = await getCredentialsByUsername("alice", db);
    expect(credentials).not.toBeNull();
    await expect(verify(credentials!.passwordHash, "newpassword456")).resolves.toBe(true);
    await expect(verify(credentials!.passwordHash, "password123")).resolves.toBe(false);
  });

  it("修改密码：旧密码错误 → AuthError(field oldPassword)", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    const error = await changePassword(
      { userId: user.id, oldPassword: "wrongpass", newPassword: "newpassword456" },
      db,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "INVALID_CREDENTIALS",
      field: "oldPassword",
      message: "旧密码不正确",
    });
  });

  it("修改密码：新密码不足 8 位 → field newPassword 且提示至少 8 位", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    const error = await changePassword(
      { userId: user.id, oldPassword: "password123", newPassword: "short12" },
      db,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "VALIDATION",
      field: "newPassword",
      message: expect.stringContaining("至少 8 位"),
    });
  });

  it("修改密码：新密码为空 → field newPassword", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    const error = await changePassword(
      { userId: user.id, oldPassword: "password123", newPassword: "" },
      db,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: "VALIDATION",
      field: "newPassword",
      message: "新密码至少 8 位",
    });
  });

  it("改密全链路：改密后新密码可登录，旧密码登录失败", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    await changePassword(
      { userId: user.id, oldPassword: "password123", newPassword: "newpassword456" },
      db,
    );

    await expect(login({ username: "alice", password: "newpassword456" }, db)).resolves.toEqual(user);
    await expect(login({ username: "alice", password: "password123" }, db)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("users service：按 id / uid 查询返回领域 User，未命中返回 null", async () => {
    const user = await registerWithCode({ username: "alice", password: "password123" }, db);

    await expect(getUserById(user.id, db)).resolves.toEqual(user);
    await expect(findByUid(user.uid, db)).resolves.toEqual(user);
    await expect(getUserById("00000000-0000-0000-0000-000000000000", db)).resolves.toBeNull();
    await expect(findByUid("doing_zzzzzz", db)).resolves.toBeNull();
  });
});
