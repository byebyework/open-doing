import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { DomainError } from "@/lib/domain-error";

import { getReminderPrefs, updateUserLanguage, updateReminderPrefs } from "./service";

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
  const [row] = await db
    .insert(users)
    .values({ uid: generateUid(), username, passwordHash: "test-hash" })
    .returning({ id: users.id });
  return row!;
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
