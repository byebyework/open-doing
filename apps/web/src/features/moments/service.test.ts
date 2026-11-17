import { addDays } from "@open-doing/types";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/domain-error";
import { todayInShanghai } from "@/lib/today";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { moments, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  createMoment,
  deleteMoment,
  listMoments,
  toggleMomentPinned,
  updateMoment,
  type MomentInput,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[features/moments/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
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

/** 完整入参（MomentInput 全字段必填），用例只覆盖关心的字段。 */
function momentInput(overrides: Partial<MomentInput> = {}): MomentInput {
  return {
    title: "时刻",
    mode: "countdown",
    anchorDate: "2026-12-01",
    cycle: null,
    weekday: null,
    dayOfMonth: null,
    pinned: false,
    ...overrides,
  };
}

/** 断言 promise 以指定 i18n key / field 的 DomainError 失败。 */
async function expectDomainError(
  promise: Promise<unknown>,
  expected: { key: string; field: string; params?: Record<string, unknown> },
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
  if (expected.params) {
    expect(domainError.i18n?.params).toMatchObject(expected.params);
  }
}

describe.skipIf(!hasTestDatabase)("moments service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates and lists with sorting：pinned → today/upcoming ASC → elapsed DESC", async () => {
    const owner = await createUser(db, "owner");

    // pinned：non-elapsed 在 elapsed 前。
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "置顶将至", mode: "countdown", anchorDate: "2026-12-01", pinned: true }) },
      db,
    );
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "置顶已过", mode: "count_up", anchorDate: "2020-01-01", pinned: true }) },
      db,
    );
    // 今天：periodic daily，days=0，应排在所有未置顶 upcoming 之前。
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "就是今天", mode: "periodic", anchorDate: "2020-01-01", cycle: "daily" }) },
      db,
    );
    // 未置顶 upcoming：按 days ASC。
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "最近将至", mode: "countdown", anchorDate: "2026-11-20" }) },
      db,
    );
    // 每月 15 日：本月已过 → 下月 2026-12-15（29 天）。
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "每月十五", mode: "periodic", anchorDate: "2020-05-15", cycle: "monthly", dayOfMonth: 15 }) },
      db,
    );
    // 未置顶 elapsed：按 days DESC。
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "刚刚过去", mode: "count_up", anchorDate: "2026-11-10" }) },
      db,
    );
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "早已过去", mode: "count_up", anchorDate: "2020-01-02" }) },
      db,
    );

    const list = await listMoments({ userId: owner.id, today: TODAY }, db);

    expect(list.map((moment) => moment.title)).toEqual([
      "置顶将至",
      "置顶已过",
      "就是今天",
      "最近将至",
      "每月十五",
      "早已过去",
      "刚刚过去",
    ]);

    expect(list.find((moment) => moment.title === "最近将至")).toMatchObject({
      pinned: false,
      mode: "countdown",
      cycle: null,
      anchorDate: "2026-11-20",
      weekday: null,
      dayOfMonth: null,
      direction: "upcoming",
      occurrenceDate: "2026-11-20",
      days: 4,
    });
    expect(list.find((moment) => moment.title === "每月十五")).toMatchObject({
      mode: "periodic",
      cycle: "monthly",
      anchorDate: "2020-05-15",
      weekday: null,
      dayOfMonth: 15,
      direction: "upcoming",
      occurrenceDate: "2026-12-15",
      days: 29,
    });
    expect(list.find((moment) => moment.title === "就是今天")).toMatchObject({
      mode: "periodic",
      cycle: "daily",
      direction: "today",
      occurrenceDate: TODAY,
      days: 0,
    });
    expect(list.find((moment) => moment.title === "刚刚过去")).toMatchObject({
      direction: "elapsed",
      occurrenceDate: "2026-11-10",
      days: 6,
    });
  });

  it("isolates by owner：他人列表不可见，update / delete / toggle 均被拒绝", async () => {
    const owner = await createUser(db, "owner");
    const other = await createUser(db, "other");

    const ownerMomentId = await createMoment(
      { userId: owner.id, ...momentInput({ title: "主人的时刻", anchorDate: "2026-12-01" }) },
      db,
    );
    await createMoment(
      { userId: other.id, ...momentInput({ title: "他人的时刻", anchorDate: "2026-12-02" }) },
      db,
    );

    const otherList = await listMoments({ userId: other.id, today: TODAY }, db);
    expect(otherList.map((moment) => moment.title)).toEqual(["他人的时刻"]);

    await expectDomainError(
      updateMoment(
        {
          userId: other.id,
          id: ownerMomentId,
          ...momentInput({ title: "被篡改", anchorDate: "2027-01-01" }),
        },
        db,
      ),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      deleteMoment({ userId: other.id, id: ownerMomentId }, db),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      toggleMomentPinned({ userId: other.id, id: ownerMomentId, pinned: true }, db),
      { key: "notFound", field: "form" },
    );

    // 他人操作无效：行仍属于原主人且内容未变。
    const [row] = await db.select().from(moments);
    expect(row).toMatchObject({
      id: ownerMomentId,
      ownerId: owner.id,
      title: "主人的时刻",
      pinned: false,
    });
  });

  it("ignores smuggled ownership keys：入参夹带的 userId / ownerId 不改变归属", async () => {
    const owner = await createUser(db, "owner");
    const other = await createUser(db, "other");

    // 模拟客户端在 input 里夹带归属字段；归一化只取已知字段，
    // 且 action 层把 userId 放在 spread 之后，归属始终由认证用户决定。
    const smuggled = {
      ...momentInput({ title: "夹带归属", anchorDate: "2026-12-01" }),
      userId: other.id,
      ownerId: other.id,
    };

    await createMoment({ ...smuggled, userId: owner.id }, db);

    const [row] = await db.select().from(moments);
    expect(row).toMatchObject({ ownerId: owner.id, title: "夹带归属" });
  });

  it("normalizes all CHECK shapes and drops smuggled shape keys", async () => {
    const owner = await createUser(db, "owner");

    // 非周期：夹带的周期字段一律置空。
    const countUpId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "正计时",
          mode: "count_up",
          anchorDate: "2020-05-20",
          cycle: "weekly",
          weekday: 5,
          dayOfMonth: 31,
        }),
      },
      db,
    );
    const countdownId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "倒计时",
          mode: "countdown",
          anchorDate: "2030-01-01",
          cycle: "monthly",
          weekday: 2,
          dayOfMonth: 9,
        }),
      },
      db,
    );

    // 周期四形态：只保留各自需要的字段（含 CHECK 边界 0/6 与 1/31）。
    const dailyId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "每日",
          mode: "periodic",
          anchorDate: "2020-01-01",
          cycle: "daily",
          weekday: 6,
          dayOfMonth: 31,
        }),
      },
      db,
    );
    const weeklyMinId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "周日",
          mode: "periodic",
          anchorDate: "2020-01-01",
          cycle: "weekly",
          weekday: 0,
          dayOfMonth: 31,
        }),
      },
      db,
    );
    const weeklyMaxId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "周六",
          mode: "periodic",
          anchorDate: "2020-01-01",
          cycle: "weekly",
          weekday: 6,
          dayOfMonth: 1,
        }),
      },
      db,
    );
    const monthlyMinId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "每月一号",
          mode: "periodic",
          anchorDate: "2020-01-01",
          cycle: "monthly",
          weekday: 3,
          dayOfMonth: 1,
        }),
      },
      db,
    );
    const monthlyMaxId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "每月三十一号",
          mode: "periodic",
          anchorDate: "2020-01-01",
          cycle: "monthly",
          weekday: 3,
          dayOfMonth: 31,
        }),
      },
      db,
    );
    const yearlyId = await createMoment(
      {
        userId: owner.id,
        ...momentInput({
          title: "闰日周年",
          mode: "periodic",
          anchorDate: "2020-02-29",
          cycle: "yearly",
          weekday: 4,
          dayOfMonth: 29,
        }),
      },
      db,
    );

    const rows = await db.select().from(moments);
    const rowOf = (id: string) => rows.find((row) => row.id === id);

    expect(rowOf(countUpId)).toMatchObject({
      mode: "count_up",
      anchorDate: "2020-05-20",
      cycle: null,
      weekday: null,
      dayOfMonth: null,
    });
    expect(rowOf(countdownId)).toMatchObject({
      mode: "countdown",
      anchorDate: "2030-01-01",
      cycle: null,
      weekday: null,
      dayOfMonth: null,
    });
    expect(rowOf(dailyId)).toMatchObject({
      mode: "periodic",
      cycle: "daily",
      weekday: null,
      dayOfMonth: null,
    });
    expect(rowOf(weeklyMinId)).toMatchObject({
      mode: "periodic",
      cycle: "weekly",
      weekday: 0,
      dayOfMonth: null,
    });
    expect(rowOf(weeklyMaxId)).toMatchObject({
      mode: "periodic",
      cycle: "weekly",
      weekday: 6,
      dayOfMonth: null,
    });
    expect(rowOf(monthlyMinId)).toMatchObject({
      mode: "periodic",
      cycle: "monthly",
      weekday: null,
      dayOfMonth: 1,
    });
    expect(rowOf(monthlyMaxId)).toMatchObject({
      mode: "periodic",
      cycle: "monthly",
      weekday: null,
      dayOfMonth: 31,
    });
    expect(rowOf(yearlyId)).toMatchObject({
      mode: "periodic",
      cycle: "yearly",
      anchorDate: "2020-02-29",
      weekday: null,
      dayOfMonth: null,
    });
  });

  it("update / delete / toggle 对本人行生效", async () => {
    const owner = await createUser(db, "owner");
    const id = await createMoment(
      { userId: owner.id, ...momentInput({ title: "原标题", anchorDate: "2026-12-01" }) },
      db,
    );

    await updateMoment(
      {
        userId: owner.id,
        id,
        ...momentInput({
          title: "新标题",
          mode: "periodic",
          anchorDate: "2020-01-01",
          cycle: "weekly",
          weekday: 5,
          pinned: true,
        }),
      },
      db,
    );
    await toggleMomentPinned({ userId: owner.id, id, pinned: false }, db);

    const [updated] = await db.select().from(moments);
    expect(updated).toMatchObject({
      title: "新标题",
      mode: "periodic",
      cycle: "weekly",
      weekday: 5,
      dayOfMonth: null,
      pinned: false,
    });

    await deleteMoment({ userId: owner.id, id }, db);
    const remaining = await db.select().from(moments);
    expect(remaining).toHaveLength(0);
  });

  it("rejects invalid title / date / future count-up anchor with field-mapped keys", async () => {
    const owner = await createUser(db, "owner");
    const userId = owner.id;

    await expectDomainError(
      createMoment({ userId, ...momentInput({ title: "   " }) }, db),
      { key: "titleRequired", field: "title" },
    );
    await expectDomainError(
      createMoment({ userId, ...momentInput({ title: "x".repeat(51) }) }, db),
      { key: "titleTooLong", field: "title", params: { max: 50 } },
    );
    await expectDomainError(
      createMoment({ userId, ...momentInput({ anchorDate: "2026-02-30" }) }, db),
      { key: "invalidDate", field: "date" },
    );
    await expectDomainError(
      createMoment({ userId, ...momentInput({ anchorDate: "not-a-date" }) }, db),
      { key: "invalidDate", field: "date" },
    );
    await expectDomainError(
      createMoment(
        {
          userId,
          ...momentInput({
            mode: "count_up",
            anchorDate: addDays(todayInShanghai(), 1),
          }),
        },
        db,
      ),
      { key: "anchorInFuture", field: "date" },
    );

    // 校验失败不应写入任何行。
    expect(await db.select().from(moments)).toHaveLength(0);
  });

  it("rejects invalid periodic cycle / weekday / day of month", async () => {
    const owner = await createUser(db, "owner");
    const userId = owner.id;
    const periodic = (overrides: Partial<MomentInput>) =>
      momentInput({ mode: "periodic", anchorDate: "2020-01-01", ...overrides });

    await expectDomainError(
      createMoment({ userId, ...periodic({ cycle: null }) }, db),
      { key: "invalidCycle", field: "form" },
    );
    await expectDomainError(
      createMoment({ userId, ...periodic({ cycle: "hourly" as never }) }, db),
      { key: "invalidCycle", field: "form" },
    );
    await expectDomainError(
      createMoment(
        { userId, ...periodic({ cycle: "weekly", weekday: 7 }) },
        db,
      ),
      { key: "invalidWeekday", field: "form" },
    );
    await expectDomainError(
      createMoment(
        { userId, ...periodic({ cycle: "weekly", weekday: -1 }) },
        db,
      ),
      { key: "invalidWeekday", field: "form" },
    );
    await expectDomainError(
      createMoment(
        { userId, ...periodic({ cycle: "weekly", weekday: 1.5 }) },
        db,
      ),
      { key: "invalidWeekday", field: "form" },
    );
    await expectDomainError(
      createMoment(
        { userId, ...periodic({ cycle: "monthly", dayOfMonth: 0 }) },
        db,
      ),
      { key: "invalidDayOfMonth", field: "form" },
    );
    await expectDomainError(
      createMoment(
        { userId, ...periodic({ cycle: "monthly", dayOfMonth: 32 }) },
        db,
      ),
      { key: "invalidDayOfMonth", field: "form" },
    );
    await expectDomainError(
      createMoment(
        { userId, ...periodic({ cycle: "monthly", dayOfMonth: 1.5 }) },
        db,
      ),
      { key: "invalidDayOfMonth", field: "form" },
    );

    expect(await db.select().from(moments)).toHaveLength(0);
  });

  it("notFound：update 目标缺失 / id 非 UUID / 本人 update 校验失败不改行", async () => {
    const owner = await createUser(db, "owner");
    const userId = owner.id;

    await expectDomainError(
      updateMoment(
        { userId, id: crypto.randomUUID(), ...momentInput({ title: "不存在" }) },
        db,
      ),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      updateMoment({ userId, id: "not-a-uuid", ...momentInput({ title: "非法 id" }) }, db),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      deleteMoment({ userId, id: "not-a-uuid" }, db),
      { key: "notFound", field: "form" },
    );
    await expectDomainError(
      toggleMomentPinned({ userId, id: "not-a-uuid", pinned: true }, db),
      { key: "notFound", field: "form" },
    );

    const id = await createMoment(
      { userId, ...momentInput({ title: "保持原样", anchorDate: "2026-12-01" }) },
      db,
    );
    await expectDomainError(
      updateMoment({ userId, id, ...momentInput({ title: " " }) }, db),
      { key: "titleRequired", field: "title" },
    );

    const [row] = await db.select().from(moments);
    expect(row).toMatchObject({ id, title: "保持原样" });
  });

  it("trims title on write", async () => {
    const owner = await createUser(db, "owner");

    await createMoment(
      { userId: owner.id, ...momentInput({ title: "  周末  " }) },
      db,
    );

    const [row] = await db.select().from(moments);
    expect(row?.title).toBe("周末");
  });

  it("limit truncates after sorting but keeps pinned first", async () => {
    const owner = await createUser(db, "owner");

    await createMoment(
      { userId: owner.id, ...momentInput({ title: "置顶已过", mode: "count_up", anchorDate: "2020-01-01", pinned: true }) },
      db,
    );
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "置顶将至", mode: "countdown", anchorDate: "2026-12-01", pinned: true }) },
      db,
    );
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "最近将至", mode: "countdown", anchorDate: "2026-11-20" }) },
      db,
    );
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "较远将至", mode: "countdown", anchorDate: "2026-12-31" }) },
      db,
    );
    await createMoment(
      { userId: owner.id, ...momentInput({ title: "刚过去", mode: "count_up", anchorDate: "2026-11-15" }) },
      db,
    );

    const list = await listMoments({ userId: owner.id, today: TODAY, limit: 3 }, db);

    expect(list.map((moment) => moment.title)).toEqual([
      "置顶将至",
      "置顶已过",
      "最近将至",
    ]);
  });
});
