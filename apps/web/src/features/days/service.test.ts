import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { importantDays, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  createImportantDay,
  deleteImportantDay,
  listImportantDays,
  toggleImportantDayPinned,
  updateImportantDay,
  type ImportantDayInput,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[features/days/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const TODAY = "2026-11-16";

async function createUser(db: DbClient, username: string) {
  const id = crypto.randomUUID();
  const uid = generateUid();
  await db.insert(users).values({
    id,
    uid,
    username,
    name: username,
    email: `${id}@test.local`,
    displayUsername: username,
  });
  return { id, username };
}

/** 完整入参（ImportantDayInput 全字段必填），用例只覆盖关心的字段。 */
function dayInput(overrides: Partial<ImportantDayInput> = {}): ImportantDayInput {
  return {
    title: "纪念日",
    date: "2026-12-01",
    isLunar: false,
    lunarMonth: null,
    lunarDay: null,
    repeat: "none",
    pinned: false,
    ...overrides,
  };
}

/** 断言 promise 以指定 i18n key / field 的 DomainError 失败。 */
async function expectDomainError(
  promise: Promise<unknown>,
  expected: { key: string; field: string },
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(DomainError);
  const domainError = caught as DomainError;
  expect(domainError.field).toBe(expected.field);
  expect(domainError.i18n?.key).toBe(expected.key);
}

describe.skipIf(!hasTestDatabase)("重要日子 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates and lists with sorting：置顶 → 临近周年 → 正计时", async () => {
    const owner = await createUser(db, "owner");

    // 置顶两条：upcoming 在 elapsed 前。
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "置顶将至", date: "2026-12-01", pinned: true }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "置顶已过", date: "2020-01-01", pinned: true }) },
      db,
    );
    // 非置顶 upcoming：按 days ASC。
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "最近将至", date: "2026-11-20" }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "较远将至", date: "2026-12-31" }) },
      db,
    );
    // 年度重复：锚点已过，下次发生日 2027-03-01（105 天）。
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "年度纪念", date: "2015-03-01", repeat: "yearly" }) },
      db,
    );
    // 非置顶 elapsed：按 days DESC。
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "刚刚过去", date: "2026-11-10" }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "早已过去", date: "2020-01-02" }) },
      db,
    );

    const list = await listImportantDays({ userId: owner.id, today: TODAY }, db);

    expect(list.map((day) => day.title)).toEqual([
      "置顶将至",
      "置顶已过",
      "最近将至",
      "较远将至",
      "年度纪念",
      "早已过去",
      "刚刚过去",
    ]);

    expect(list.find((day) => day.title === "最近将至")).toMatchObject({
      pinned: false,
      isLunar: false,
      repeat: "none",
      anchorDate: "2026-11-20",
      lunarMonth: null,
      lunarDay: null,
      direction: "upcoming",
      occurrenceDate: "2026-11-20",
      days: 4,
    });
    expect(list.find((day) => day.title === "年度纪念")).toMatchObject({
      repeat: "yearly",
      anchorDate: "2015-03-01",
      direction: "upcoming",
      occurrenceDate: "2027-03-01",
      days: 105,
    });
    expect(list.find((day) => day.title === "刚刚过去")).toMatchObject({
      direction: "elapsed",
      occurrenceDate: "2026-11-10",
      days: 6,
    });
  });

  it("isolates by owner：他人列表不可见，update / delete / toggle 均被拒绝", async () => {
    const owner = await createUser(db, "owner");
    const other = await createUser(db, "other");

    const ownerDayId = await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "主人的日子", date: "2026-12-01" }) },
      db,
    );
    await createImportantDay(
      { userId: other.id, ...dayInput({ title: "他人的日子", date: "2026-12-02" }) },
      db,
    );

    const otherList = await listImportantDays({ userId: other.id, today: TODAY }, db);
    expect(otherList.map((day) => day.title)).toEqual(["他人的日子"]);

    await expectDomainError(
      updateImportantDay(
        { userId: other.id, id: ownerDayId, ...dayInput({ title: "被篡改", date: "2027-01-01" }) },
        db,
      ),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      deleteImportantDay({ userId: other.id, id: ownerDayId }, db),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      toggleImportantDayPinned({ userId: other.id, id: ownerDayId, pinned: true }, db),
      { key: "notFound", field: "form" },
    );

    // 他人操作无效：行仍属于原主人且内容未变。
    const [row] = await db.select().from(importantDays);
    expect(row).toMatchObject({ id: ownerDayId, ownerId: owner.id, title: "主人的日子", pinned: false });
  });

  it("update / delete / toggle 对本人行生效", async () => {
    const owner = await createUser(db, "owner");
    const id = await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "原标题", date: "2026-12-01" }) },
      db,
    );

    await updateImportantDay(
      { userId: owner.id, id, ...dayInput({ title: "新标题", date: "2026-12-05", pinned: true }) },
      db,
    );
    await toggleImportantDayPinned({ userId: owner.id, id, pinned: false }, db);

    const [updated] = await db.select().from(importantDays);
    expect(updated).toMatchObject({ title: "新标题", date: "2026-12-05", pinned: false });

    await deleteImportantDay({ userId: owner.id, id }, db);
    const remaining = await db.select().from(importantDays);
    expect(remaining).toHaveLength(0);
  });

  it("normalizes lunar input：isLunar 强制 repeat=yearly、date=null", async () => {
    const owner = await createUser(db, "owner");

    const id = await createImportantDay(
      {
        userId: owner.id,
        ...dayInput({
          title: "农历生日",
          date: "2026-12-01",
          isLunar: true,
          lunarMonth: 8,
          lunarDay: 15,
          repeat: "none",
        }),
      },
      db,
    );

    const [row] = await db.select().from(importantDays);
    expect(row).toMatchObject({
      id,
      date: null,
      isLunar: true,
      lunarMonth: 8,
      lunarDay: 15,
      repeat: "yearly",
    });

    const list = await listImportantDays({ userId: owner.id, today: TODAY }, db);
    expect(list[0]).toMatchObject({
      id,
      anchorDate: null,
      isLunar: true,
      repeat: "yearly",
      lunarMonth: 8,
      lunarDay: 15,
    });
  });

  it("rejects invalid title / date / lunar day with field-mapped i18n keys", async () => {
    const owner = await createUser(db, "owner");
    const userId = owner.id;

    await expectDomainError(
      createImportantDay({ userId, ...dayInput({ title: "   " }) }, db),
      { key: "titleRequired", field: "title" },
    );
    await expectDomainError(
      createImportantDay({ userId, ...dayInput({ title: "x".repeat(51) }) }, db),
      { key: "titleTooLong", field: "title" },
    );
    await expectDomainError(
      createImportantDay({ userId, ...dayInput({ date: "2026-02-30" }) }, db),
      { key: "invalidDate", field: "date" },
    );
    await expectDomainError(
      createImportantDay({ userId, ...dayInput({ date: null }) }, db),
      { key: "invalidDate", field: "date" },
    );
    await expectDomainError(
      createImportantDay(
        {
          userId,
          ...dayInput({ date: null, isLunar: true, lunarMonth: 13, lunarDay: 15 }),
        },
        db,
      ),
      { key: "invalidLunarDay", field: "form" },
    );
    await expectDomainError(
      createImportantDay(
        {
          userId,
          ...dayInput({ date: null, isLunar: true, lunarMonth: 8, lunarDay: 31 }),
        },
        db,
      ),
      { key: "invalidLunarDay", field: "form" },
    );
    await expectDomainError(
      createImportantDay(
        {
          userId,
          ...dayInput({ date: null, isLunar: true, lunarMonth: null, lunarDay: 15 }),
        },
        db,
      ),
      { key: "invalidLunarDay", field: "form" },
    );

    // 校验失败不应写入任何行。
    expect(await db.select().from(importantDays)).toHaveLength(0);
  });

  it("limit truncates but keeps pinned first", async () => {
    const owner = await createUser(db, "owner");

    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "置顶已过", date: "2020-01-01", pinned: true }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "置顶将至", date: "2026-12-01", pinned: true }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "最近将至", date: "2026-11-20" }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "较远将至", date: "2026-12-31" }) },
      db,
    );
    await createImportantDay(
      { userId: owner.id, ...dayInput({ title: "刚过去", date: "2026-11-15" }) },
      db,
    );

    const list = await listImportantDays({ userId: owner.id, today: TODAY, limit: 3 }, db);

    expect(list.map((day) => day.title)).toEqual([
      "置顶将至",
      "置顶已过",
      "最近将至",
    ]);
  });
});
