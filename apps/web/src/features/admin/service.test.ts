import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // app db 单例在模块加载时读取 DATABASE_URL；把默认 client 也指向测试库，
  // 避免任何遗漏的默认参数调用落到开发库。
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

import type { DbClient } from "@/server/db/client";
import {
  projects,
  registrationCodes,
  sessions,
  tasks,
  teamMemberships,
  teams,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  AdminError,
  getAdminOverview,
  getAdminUserDetail,
  listAdminCodes,
  listAdminUsers,
  setUserAdmin,
  setUserDisabled,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[admin/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户（绕过 better-auth 密码哈希），返回内部主键。 */
async function insertUser(
  client: DbClient,
  input: {
    username: string;
    uid: string;
    email?: string;
    nickname?: string;
    isAdmin?: boolean;
    isDisabled?: boolean;
    registrationCodeId?: string | null;
    createdAt?: Date;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await client.insert(users).values({
    id,
    uid: input.uid,
    username: input.username,
    name: input.nickname ?? input.username,
    email: input.email ?? `${input.username.toLowerCase()}@test.local`,
    displayUsername: input.username,
    isAdmin: input.isAdmin ?? false,
    isDisabled: input.isDisabled ?? false,
    registrationCodeId: input.registrationCodeId ?? null,
    createdAt: input.createdAt ?? new Date(),
  });
  return id;
}

/** 直插团队并由指定用户成为 owner（同时写入 owner 成员关系）。 */
async function insertTeam(
  client: DbClient,
  input: { name: string; ownerId: string; createdAt?: Date; joinedAt?: Date },
): Promise<string> {
  const id = crypto.randomUUID();
  await client.insert(teams).values({
    id,
    name: input.name,
    slug: `team-${id}`,
    joinCode: id.replaceAll("-", "").slice(0, 8).toUpperCase(),
    ownerId: input.ownerId,
    createdAt: input.createdAt ?? new Date(),
  });
  await client.insert(teamMemberships).values({
    teamId: id,
    userId: input.ownerId,
    role: "owner",
    joinedAt: input.joinedAt ?? new Date(),
  });
  return id;
}

/** 追加一条团队成员关系（团队级别由调用方保证）。 */
async function insertMembership(
  client: DbClient,
  input: {
    teamId: string;
    userId: string;
    role: "owner" | "admin" | "member";
    joinedAt?: Date;
  },
): Promise<void> {
  await client.insert(teamMemberships).values({
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    joinedAt: input.joinedAt ?? new Date(),
  });
}

/** 直插注册码，返回内部主键（供 users.registration_code_id 引用）。 */
async function insertCode(
  client: DbClient,
  input: { code: string; maxUses: number; usedCount: number; createdAt: Date },
): Promise<string> {
  const id = crypto.randomUUID();
  await client.insert(registrationCodes).values({ id, ...input });
  return id;
}

describe.skipIf(!hasTestDatabase)("admin service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("listAdminUsers", () => {
    it("searches by username/email/uid substring, case-insensitive", async () => {
      const alice = await insertUser(db, {
        username: "alice",
        uid: "doing_alpha01",
        email: "hello@example.com",
        nickname: "阿岚",
        isAdmin: true,
        createdAt: new Date("2026-11-01T00:00:00Z"),
      });
      await insertUser(db, {
        username: "bob",
        uid: "doing_bravo02",
        email: "bob@example.com",
        isDisabled: true,
        createdAt: new Date("2026-11-02T00:00:00Z"),
      });

      // alice 属于 2 个团队，bob 不属于任何团队。
      await insertTeam(db, { name: "Alpha Squad", ownerId: alice });
      await insertTeam(db, { name: "Bravo Squad", ownerId: alice });

      const all = await listAdminUsers(null, db);
      expect(all.map((user) => user.username).sort()).toEqual(["alice", "bob"]);

      const aliceSummary = all.find((user) => user.username === "alice")!;
      expect(aliceSummary).toMatchObject({
        uid: "doing_alpha01",
        nickname: "阿岚",
        email: "hello@example.com",
        teamCount: 2,
        isAdmin: true,
        isDisabled: false,
      });
      expect(Number.isNaN(Date.parse(aliceSummary.createdAt))).toBe(false);

      const bobSummary = all.find((user) => user.username === "bob")!;
      expect(bobSummary).toMatchObject({
        teamCount: 0,
        isAdmin: false,
        isDisabled: true,
      });

      // username 子串 + 大小写不敏感。
      expect((await listAdminUsers("ALI", db)).map((user) => user.username)).toEqual([
        "alice",
      ]);
      // email 子串：库中存 "hello@..." 小写，查询用大写同样命中。
      expect((await listAdminUsers("HE", db)).map((user) => user.username)).toEqual([
        "alice",
      ]);
      // uid 子串。
      expect(
        (await listAdminUsers("doing_", db)).map((user) => user.username).sort(),
      ).toEqual(["alice", "bob"]);
      expect(
        (await listAdminUsers("bravo", db)).map((user) => user.username),
      ).toEqual(["bob"]);
    });

    it("escapes ilike wildcards in the query", async () => {
      await insertUser(db, { username: "carol", uid: "doing_charlie03" });

      // "%" 是 ILIKE 通配符；转义后按字面量匹配，任何用户名/邮箱/uid 都不含
      // 字面 "%"，因此返回空数组而不是全表。
      await expect(listAdminUsers("%", db)).resolves.toEqual([]);
      await expect(listAdminUsers("zzz", db)).resolves.toEqual([]);
    });
  });

  describe("setUserDisabled", () => {
    it("toggles the flag", async () => {
      const actor = await insertUser(db, { username: "actor", uid: "doing_actor01" });
      const target = await insertUser(db, { username: "target", uid: "doing_target01" });

      await setUserDisabled(target, true, actor, db);
      let [row] = await db
        .select({ isDisabled: users.isDisabled })
        .from(users)
        .where(eq(users.id, target));
      expect(row!.isDisabled).toBe(true);

      await setUserDisabled(target, false, actor, db);
      [row] = await db
        .select({ isDisabled: users.isDisabled })
        .from(users)
        .where(eq(users.id, target));
      expect(row!.isDisabled).toBe(false);
    });

    it("refuses to operate on self", async () => {
      const actor = await insertUser(db, { username: "actor", uid: "doing_actor01" });

      await expect(setUserDisabled(actor, true, actor, db)).rejects.toMatchObject({
        field: "form",
        i18n: { key: "selfOperation" },
      });
    });

    it("fails with targetNotFound for an unknown user", async () => {
      const actor = await insertUser(db, { username: "actor", uid: "doing_actor01" });
      const unknown = crypto.randomUUID();

      const promise = setUserDisabled(unknown, true, actor, db);
      await expect(promise).rejects.toBeInstanceOf(AdminError);
      await expect(promise).rejects.toMatchObject({
        i18n: { key: "targetNotFound" },
      });
    });
  });

  describe("setUserAdmin", () => {
    it("toggles the flag", async () => {
      const actor = await insertUser(db, { username: "actor", uid: "doing_actor01" });
      const target = await insertUser(db, { username: "target", uid: "doing_target01" });

      await setUserAdmin(target, true, actor, db);
      let [row] = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, target));
      expect(row!.isAdmin).toBe(true);

      await setUserAdmin(target, false, actor, db);
      [row] = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, target));
      expect(row!.isAdmin).toBe(false);
    });

    it("refuses to operate on self", async () => {
      const actor = await insertUser(db, { username: "actor", uid: "doing_actor01" });

      await expect(setUserAdmin(actor, true, actor, db)).rejects.toMatchObject({
        field: "form",
        i18n: { key: "selfOperation" },
      });
    });

    it("fails with targetNotFound for an unknown user", async () => {
      const actor = await insertUser(db, { username: "actor", uid: "doing_actor01" });

      await expect(
        setUserAdmin(crypto.randomUUID(), true, actor, db),
      ).rejects.toMatchObject({ i18n: { key: "targetNotFound" } });
    });
  });

  describe("getAdminOverview / getAdminUserDetail / listAdminCodes", () => {
    it("returns overview counts, user detail and registration code usage", async () => {
      // 2 码：10 用 3（创建较早）、5 用 5（创建较晚）→ 总名额 15 / 已用 8 / 剩余 7。
      const codeFirst = await insertCode(db, {
        code: "CODEAAAA",
        maxUses: 10,
        usedCount: 3,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
      await insertCode(db, {
        code: "CODEBBBB",
        maxUses: 5,
        usedCount: 5,
        createdAt: new Date("2026-10-02T00:00:00Z"),
      });

      // 2 用户，均凭 codeFirst 注册；alice 注册较早。
      const alice = await insertUser(db, {
        username: "alice",
        uid: "doing_alpha01",
        email: "hello@example.com",
        nickname: "阿岚",
        isAdmin: true,
        registrationCodeId: codeFirst,
        createdAt: new Date("2026-11-01T00:00:00Z"),
      });
      const bob = await insertUser(db, {
        username: "bob",
        uid: "doing_bravo02",
        email: "bob@example.com",
        registrationCodeId: codeFirst,
        createdAt: new Date("2026-11-02T00:00:00Z"),
      });

      // 1 团队，2 名成员（alice owner、bob member）。
      const teamId = await insertTeam(db, {
        name: "Alpha Squad",
        ownerId: alice,
        createdAt: new Date("2026-11-03T00:00:00Z"),
        joinedAt: new Date("2026-11-03T00:00:00Z"),
      });
      await insertMembership(db, {
        teamId,
        userId: bob,
        role: "member",
        joinedAt: new Date("2026-11-04T00:00:00Z"),
      });

      // 2 项目：1 团队项目 + 1 个人项目。
      const teamProjectId = crypto.randomUUID();
      await db.insert(projects).values({
        id: teamProjectId,
        teamId,
        name: "Team Project",
        slug: "team-project",
      });
      await db.insert(projects).values({
        id: crypto.randomUUID(),
        ownerId: bob,
        name: "Personal Project",
        slug: "personal-project",
      });

      // 4 任务：一条未完成且截止日为过去的任务计入逾期；已完成的不计。
      await db.insert(tasks).values([
        {
          projectId: teamProjectId,
          spaceType: "team",
          title: "Team task 1",
          dueDate: "2020-01-01",
          createdById: alice,
        },
        {
          projectId: teamProjectId,
          spaceType: "team",
          title: "Team task 2",
          status: "done",
          dueDate: "2020-01-01",
          createdById: bob,
        },
        { spaceType: "personal", title: "Personal task 1", createdById: bob },
        { spaceType: "personal", title: "Personal task 2", createdById: alice },
      ]);

      // alice 的 2 个会话（createdAt 显式错开，验证倒序取最近 10 条）。
      const olderSessionId = crypto.randomUUID();
      const newerSessionId = crypto.randomUUID();
      await db.insert(sessions).values([
        {
          id: olderSessionId,
          userId: alice,
          token: "token-old",
          expiresAt: new Date("2026-12-01T00:00:00Z"),
          ipAddress: "10.0.0.1",
          userAgent: "Old Agent",
          createdAt: new Date("2026-11-05T00:00:00Z"),
        },
        {
          id: newerSessionId,
          userId: alice,
          token: "token-new",
          expiresAt: new Date("2026-12-02T00:00:00Z"),
          ipAddress: null,
          userAgent: null,
          createdAt: new Date("2026-11-06T00:00:00Z"),
        },
      ]);

      await expect(getAdminOverview(db)).resolves.toEqual({
        userCount: 2,
        adminCount: 1,
        disabledCount: 0,
        teamCount: 1,
        membershipCount: 2,
        projectCount: 2,
        personalProjectCount: 1,
        teamProjectCount: 1,
        taskCount: 4,
        overdueTaskCount: 1,
        regCodeCount: 2,
        regCodeTotalQuota: 15,
        regCodeUsed: 8,
        regCodeRemaining: 7,
      });

      const detail = await getAdminUserDetail(alice, db);
      expect(detail).not.toBeNull();
      expect(detail!.user).toMatchObject({
        id: alice,
        uid: "doing_alpha01",
        username: "alice",
        nickname: "阿岚",
        email: "hello@example.com",
        teamCount: 1,
        isAdmin: true,
        isDisabled: false,
        registrationCode: "CODEAAAA",
      });
      expect(Number.isNaN(Date.parse(detail!.user.createdAt))).toBe(false);

      expect(detail!.teams).toEqual([
        {
          id: teamId,
          name: "Alpha Squad",
          role: "owner",
          joinedAt: "2026-11-03T00:00:00.000Z",
        },
      ]);
      expect(detail!.sessions.map((session) => session.id)).toEqual([
        newerSessionId,
        olderSessionId,
      ]);
      expect(detail!.sessions[0]).toMatchObject({
        ipAddress: null,
        userAgent: null,
      });
      expect(detail!.sessions[1]).toMatchObject({
        ipAddress: "10.0.0.1",
        userAgent: "Old Agent",
      });

      await expect(getAdminUserDetail(crypto.randomUUID(), db)).resolves.toBeNull();

      // 码按创建时间倒序；usedBy 按用户注册时间升序。
      const codes = await listAdminCodes(db);
      expect(codes.map((code) => code.code)).toEqual(["CODEBBBB", "CODEAAAA"]);

      const first = codes.find((code) => code.code === "CODEAAAA")!;
      expect(first).toMatchObject({ maxUses: 10, usedCount: 3 });
      expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
      expect(first.usedBy.map((user) => user.username)).toEqual(["alice", "bob"]);
      expect(first.usedBy[0]).toMatchObject({
        id: alice,
        uid: "doing_alpha01",
        nickname: "阿岚",
      });
      expect(
        Date.parse(first.usedBy[1]!.createdAt) >
          Date.parse(first.usedBy[0]!.createdAt),
      ).toBe(true);

      const second = codes.find((code) => code.code === "CODEBBBB")!;
      expect(second.usedBy).toEqual([]);
    });
  });
});
