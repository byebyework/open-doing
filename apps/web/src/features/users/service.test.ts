import type { Gender } from "@open-doing/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { DomainError } from "@/lib/domain-error";

import { NICKNAME_MAX_LENGTH } from "./constants";
import {
  getProfile,
  getReminderPrefs,
  toDomainUser,
  updateProfile,
  updateUserLanguage,
  updateReminderPrefs,
  type UserProfile,
} from "./service";

/**
 * service 通过默认参数 `= db` 惰性消费 `@/server/db/client` 的 `db`；本用例沿用
 * analysis / calendar / kanban `service.test.ts` 的 Proxy 模式：每次属性访问读取
 * `testDbRef.current`，把默认 db 指向当前测试库实例。
 *
 * 所有调用仍显式传入 `db`，Proxy 只是保证模块导入阶段不会创建真实连接池。
 */
const testDbRef = vi.hoisted(() => ({
  current: null as DbClient | null,
}));

vi.mock("@/server/db/client", () => ({
  db: new Proxy(
    {},
    {
      get(_target, property, receiver) {
        if (!testDbRef.current) {
          throw new Error("测试数据库未初始化：先调用 setupTestDb()");
        }
        return Reflect.get(testDbRef.current, property, receiver);
      },
    },
  ),
}));

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[users/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 用户夹具：故意不写提醒开关列，让数据库默认值生效。 */
async function createUser(db: DbClient, username: string) {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    uid: generateUid(),
    username,
    // better-auth 行：展示名 / 邮箱 / displayUsername 均为 NOT NULL。
    name: username,
    email: `${id}@test.local`,
    displayUsername: username,
  });
  return { id };
}

/** 不存在的用户 ID（合法 UUID，但库里没有此用户）。 */
const MISSING_USER_ID = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!hasTestDatabase)("用户提醒偏好读写", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("① 新建用户默认两个提醒开关均开启（钉迁移 DEFAULT true / NOT NULL）", async () => {
    const user = await createUser(db, "林夏");

    await expect(getReminderPrefs(user.id, db)).resolves.toEqual({
      dueSoonReminderEnabled: true,
      overdueReminderEnabled: true,
    });
  });

  it("② 部分更新只改传入的键，另一个键保持原值（不整行覆盖）", async () => {
    const user = await createUser(db, "林夏");

    // 先关闭「临期提醒」，逾期提醒应保持默认开启。
    await expect(
      updateReminderPrefs({ userId: user.id, dueSoonReminderEnabled: false }, db),
    ).resolves.toEqual({
      dueSoonReminderEnabled: false,
      overdueReminderEnabled: true,
    });

    // 再只关闭「逾期提醒」：若实现把未传的 dueSoon 也按默认值/undefined
    // 重新写回，上一轮的 false 会被覆盖成 true，下面的断言即失败。
    await expect(
      updateReminderPrefs({ userId: user.id, overdueReminderEnabled: false }, db),
    ).resolves.toEqual({
      dueSoonReminderEnabled: false,
      overdueReminderEnabled: false,
    });

    // 落库结果与返回值一致。
    await expect(getReminderPrefs(user.id, db)).resolves.toEqual({
      dueSoonReminderEnabled: false,
      overdueReminderEnabled: false,
    });
  });

  it("③ 同时更新两个键：字段映射不串位，返回更新后全量", async () => {
    const user = await createUser(db, "林夏");
    // 先制造一真一假，确保下面的更新不是「两个都变同一侧」的偶然通过。
    await updateReminderPrefs(
      { userId: user.id, dueSoonReminderEnabled: false },
      db,
    );

    await expect(
      updateReminderPrefs(
        {
          userId: user.id,
          dueSoonReminderEnabled: true,
          overdueReminderEnabled: false,
        },
        db,
      ),
    ).resolves.toEqual({
      dueSoonReminderEnabled: true,
      overdueReminderEnabled: false,
    });

    await expect(getReminderPrefs(user.id, db)).resolves.toEqual({
      dueSoonReminderEnabled: true,
      overdueReminderEnabled: false,
    });
  });

  it("④ 用户不存在时 getReminderPrefs 抛错", async () => {
    await expect(getReminderPrefs(MISSING_USER_ID, db)).rejects.toThrow(
      "user not found",
    );
  });
});

describe.skipIf(!hasTestDatabase)("用户界面语言读写", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("① 新建用户默认界面语言为 zh（钉迁移 DEFAULT 'zh' / NOT NULL）", async () => {
    const user = await createUser(db, "林夏");

    const [row] = await db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    expect(row!.language).toBe("zh");
  });

  it("② updateUserLanguage 更新语言并返回持久化值", async () => {
    const user = await createUser(db, "林夏");

    await expect(
      updateUserLanguage({ userId: user.id, language: "en" }, db),
    ).resolves.toBe("en");

    const [row] = await db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    expect(row!.language).toBe("en");
  });

  it("③ 用户不存在时 updateUserLanguage 抛 DomainError", async () => {
    await expect(
      updateUserLanguage({ userId: MISSING_USER_ID, language: "en" }, db),
    ).rejects.toThrow(DomainError);
  });
});

/** 带个人资料的夹具：显式写入四个可选列，便于断言读写结果。 */
async function createProfileUser(
  db: DbClient,
  username: string,
  profile: UserProfile = {
    nickname: null,
    gender: null,
    email: null,
    phone: null,
  },
) {
  const id = crypto.randomUUID();
  // 领域 nickname -> better-auth `name`；邮箱 NOT NULL，未填时用测试兜底地址。
  const fallbackEmail = `${id}@test.local`;
  await db.insert(users).values({
    id,
    uid: generateUid(),
    username,
    name: profile.nickname ?? username,
    displayUsername: username,
    email: profile.email ?? fallbackEmail,
    gender: profile.gender,
    phone: profile.phone,
  });
  return { id, fallbackEmail };
}

describe.skipIf(!hasTestDatabase)("个人资料读写", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
    testDbRef.current = db;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("① getProfile 返回四个可选资料字段", async () => {
    const user = await createProfileUser(db, "林夏", {
      nickname: "阿岚",
      gender: "female",
      email: "lan@example.com",
      phone: "13800138000",
    });

    await expect(getProfile(user.id, db)).resolves.toEqual({
      nickname: "阿岚",
      gender: "female",
      email: "lan@example.com",
      phone: "13800138000",
    });
  });

  it("② updateProfile 归一化：trim、邮箱小写，空字符串归一化为 null", async () => {
    const user = await createProfileUser(db, "林夏");

    // 昵称 trim 后写入，邮箱 trim + 小写，电话 trim。
    await expect(
      updateProfile(
        {
          userId: user.id,
          nickname: "  阿岚  ",
          gender: "female",
          email: "  LAN@Example.COM ",
          phone: " +86-13800138000 ",
        },
        db,
      ),
    ).resolves.toEqual({
      nickname: "阿岚",
      gender: "female",
      email: "lan@example.com",
      phone: "+86-13800138000",
    });

    // 空字符串（等价于表单清空）= 归一化为 null；昵称空串不改变当前值。
    // better-auth 的 email 必填：空邮箱按保持当前值处理，不清空登录邮箱。
    await expect(
      updateProfile(
        {
          userId: user.id,
          nickname: "   ",
          gender: "" as Gender,
          email: "",
          phone: "",
        },
        db,
      ),
    ).resolves.toEqual({
      nickname: "阿岚",
      gender: null,
      email: "lan@example.com",
      phone: null,
    });
  });

  it("③ 非法性别 / 邮箱 / 电话 / 超长昵称抛 UserError（字段与 i18n key 正确）", async () => {
    const user = await createProfileUser(db, "林夏");

    await expect(
      updateProfile({ userId: user.id, gender: "other" as Gender }, db),
    ).rejects.toMatchObject({
      name: "UserError",
      field: "gender",
      i18n: { key: "genderInvalid" },
    });

    await expect(
      updateProfile({ userId: user.id, email: "not-an-email" }, db),
    ).rejects.toMatchObject({
      name: "UserError",
      field: "email",
      i18n: { key: "emailInvalid" },
    });

    await expect(
      updateProfile({ userId: user.id, phone: "abc-123" }, db),
    ).rejects.toMatchObject({
      name: "UserError",
      field: "phone",
      i18n: { key: "phoneInvalid" },
    });

    await expect(
      updateProfile(
        { userId: user.id, nickname: "x".repeat(NICKNAME_MAX_LENGTH + 1) },
        db,
      ),
    ).rejects.toMatchObject({
      name: "UserError",
      field: "nickname",
      i18n: { key: "nicknameMaxLength", params: { max: NICKNAME_MAX_LENGTH } },
    });
  });

  it("④ 邮箱与他人冲突时按唯一索引抛 emailTaken（不泄露数据库错误）", async () => {
    await createProfileUser(db, "已有邮箱的用户", {
      nickname: null,
      gender: null,
      email: "taken@example.com",
      phone: null,
    });
    const user = await createProfileUser(db, "林夏");

    // 大小写不同同样冲突：写入前统一 lowercase，唯一索引按归一化后的精确值比较。
    await expect(
      updateProfile({ userId: user.id, email: "TAKEN@example.com" }, db),
    ).rejects.toMatchObject({
      name: "UserError",
      field: "email",
      i18n: { key: "emailTaken" },
    });

    // 事务回滚：冲突值没有写进库。
    await expect(getProfile(user.id, db)).resolves.toEqual({
      nickname: "林夏",
      gender: null,
      email: user.fallbackEmail,
      phone: null,
    });
  });

  it("⑤ updateProfile 未传任何键时返回当前值", async () => {
    const current: UserProfile = {
      nickname: "阿岚",
      gender: "secret",
      email: "lan@example.com",
      phone: "13800138000",
    };
    const user = await createProfileUser(db, "林夏", current);

    await expect(updateProfile({ userId: user.id }, db)).resolves.toEqual(current);
  });

  it("⑥ 用户不存在时 getProfile 抛 UserError", async () => {
    await expect(getProfile(MISSING_USER_ID, db)).rejects.toMatchObject({
      name: "UserError",
      field: "form",
    });
  });
});

describe("toDomainUser admin fields", () => {
  it("maps isAdmin/isDisabled from the row", () => {
    const user = toDomainUser({
      id: "u1", name: "n", createdAt: new Date("2026-01-01"),
      isAdmin: true, isDisabled: true,
    });
    expect(user.isAdmin).toBe(true);
    expect(user.isDisabled).toBe(true);
  });
  it("defaults to false when better-auth omits the fields", () => {
    const user = toDomainUser({ id: "u2", name: "n", createdAt: new Date("2026-01-01") });
    expect(user.isAdmin).toBe(false);
    expect(user.isDisabled).toBe(false);
  });
});
