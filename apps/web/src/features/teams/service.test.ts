import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { teamMemberships, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamError, createTeam, getTeamBySlug, listTeamsForUser } from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[teams/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户，避免每个用例都走 argon2 哈希。 */
async function createUser(db: DbClient, username: string): Promise<{ id: string }> {
  const [row] = await db
    .insert(users)
    .values({ uid: generateUid(), username, passwordHash: "test-hash" })
    .returning({ id: users.id });
  return row!;
}

describe.skipIf(!hasTestDatabase)("团队 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("创建成功：返回 Team 并自动建立 owner 成员关系", async () => {
    const owner = await createUser(db, "alice");

    const team = await createTeam({ name: "增长突击队" }, owner.id, db);

    expect(team.name).toBe("增长突击队");
    expect(team.ownerId).toBe(owner.id);
    expect(team.slug).toBeTruthy();
    expect(Number.isNaN(Date.parse(team.createdAt))).toBe(false);

    const memberships = await db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, team.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ userId: owner.id, role: "owner" });
  });

  it("名称校验：trim 后需为 2–30 字符", async () => {
    const owner = await createUser(db, "alice");

    await expect(createTeam({ name: "  " }, owner.id, db)).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
    });
    await expect(createTeam({ name: "团" }, owner.id, db)).rejects.toBeInstanceOf(TeamError);
    await expect(createTeam({ name: "团".repeat(31) }, owner.id, db)).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
    });
    await expect(createTeam({ name: " 突击队 " }, owner.id, db)).resolves.toMatchObject({
      name: "突击队",
    });
  });

  it("同名团队：slug 追加计数后缀不冲突", async () => {
    const owner = await createUser(db, "alice");

    const first = await createTeam({ name: "Growth Squad" }, owner.id, db);
    const second = await createTeam({ name: "Growth Squad" }, owner.id, db);

    expect(first.slug).toBe("growth-squad");
    expect(second.slug).toBe("growth-squad-2");
  });

  it("纯中文团队名：slug 回退为 team 并处理重名", async () => {
    const owner = await createUser(db, "alice");

    const first = await createTeam({ name: "增长突击队" }, owner.id, db);
    const second = await createTeam({ name: "效率工程部" }, owner.id, db);

    expect(first.slug).toBe("team");
    expect(second.slug).toBe("team-2");
  });

  it("listTeamsForUser：只含所在团队，按创建时间升序", async () => {
    const member = await createUser(db, "member");
    const outsider = await createUser(db, "outsider");

    const first = await createTeam({ name: "First Team" }, member.id, db);
    const second = await createTeam({ name: "Second Team" }, member.id, db);

    const mine = await listTeamsForUser(member.id, db);
    expect(mine.map((team) => team.id)).toEqual([first.id, second.id]);
    expect(await listTeamsForUser(outsider.id, db)).toEqual([]);
  });

  it("getTeamBySlug：命中返回 Team，未命中返回 null", async () => {
    const owner = await createUser(db, "alice");
    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);

    expect(await getTeamBySlug(team.slug, db)).toEqual(team);
    expect(await getTeamBySlug("no-such-team", db)).toBeNull();
  });
});
