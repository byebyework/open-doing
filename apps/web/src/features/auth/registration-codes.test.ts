import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/server/db/client";
import { registrationCodes } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  REGISTRATION_CODE_MAX_USES,
  consumeRegistrationCode,
  generateRegistrationCodes,
  listRegistrationCodes,
} from "./registration-codes";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[auth/registration-codes.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=mysql://open-doing:open-doing@localhost:3307/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("注册码 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("生成注册码：N 个互不相同、符合入群码字符集，落库为未使用状态", async () => {
    const codes = await generateRegistrationCodes(3, db);

    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    }

    const rows = await db.select().from(registrationCodes);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(codes).toContain(row.code);
      expect(row.maxUses).toBe(REGISTRATION_CODE_MAX_USES);
      expect(row.usedCount).toBe(0);
    }
  });

  it("查询注册码列表：返回码、已用次数、上限，按创建时间倒序", async () => {
    const [first] = await generateRegistrationCodes(1, db);
    await generateRegistrationCodes(1, db);
    await consumeRegistrationCode(first!, db);

    const list = await listRegistrationCodes(db);

    expect(list).toHaveLength(2);
    // 同批两个码可能落在同一时间戳，倒序对相同时间戳不稳定；
    // 只断言时间戳单调不增与各码的使用次数。
    const byCode = new Map(list.map((row) => [row.code, row]));
    expect(byCode.get(first!)).toMatchObject({ usedCount: 1, maxUses: REGISTRATION_CODE_MAX_USES });
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(list[i]!.createdAt.getTime());
    }
    expect(list.find((row) => row.code !== first)!.usedCount).toBe(0);
  });

  describe("consumeRegistrationCode", () => {
    it("有效且未用尽的码：返回 ok，使用次数 +1", async () => {
      const [code] = await generateRegistrationCodes(1, db);

      await expect(consumeRegistrationCode(code!, db)).resolves.toBe("ok");

      const [row] = await db
        .select()
        .from(registrationCodes)
        .where(eq(registrationCodes.code, code!));
      expect(row!.usedCount).toBe(1);
    });

    it("输入带空白或小写：与入群码同规则归一化（去空白 + 大写）后命中", async () => {
      const [code] = await generateRegistrationCodes(1, db);

      await expect(consumeRegistrationCode(` ${code!.toLowerCase()} `, db)).resolves.toBe("ok");
    });

    it("不存在的码：返回 invalid，不产生任何写入", async () => {
      await expect(consumeRegistrationCode("ZZZZZZZZ", db)).resolves.toBe("invalid");
      expect(await db.select().from(registrationCodes)).toHaveLength(0);
    });

    it("已用尽的码：返回 exhausted，次数不再增加", async () => {
      const [code] = await generateRegistrationCodes(1, db);
      await db
        .update(registrationCodes)
        .set({ usedCount: REGISTRATION_CODE_MAX_USES })
        .where(eq(registrationCodes.code, code!));

      await expect(consumeRegistrationCode(code!, db)).resolves.toBe("exhausted");

      const [row] = await db
        .select()
        .from(registrationCodes)
        .where(eq(registrationCodes.code, code!));
      expect(row!.usedCount).toBe(REGISTRATION_CODE_MAX_USES);
    });

    it("最后一次名额：并发竞争只允许一个成功（原子条件更新）", async () => {
      const [code] = await generateRegistrationCodes(1, db);
      await db
        .update(registrationCodes)
        .set({ usedCount: REGISTRATION_CODE_MAX_USES - 1 })
        .where(eq(registrationCodes.code, code!));

      const results = await Promise.all([
        consumeRegistrationCode(code!, db),
        consumeRegistrationCode(code!, db),
      ]);

      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results.filter((r) => r === "exhausted")).toHaveLength(1);
      const [row] = await db
        .select()
        .from(registrationCodes)
        .where(eq(registrationCodes.code, code!));
      expect(row!.usedCount).toBe(REGISTRATION_CODE_MAX_USES);
    });
  });
});
