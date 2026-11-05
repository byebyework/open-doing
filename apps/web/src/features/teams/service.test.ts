import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { teamMemberships, teams, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamPermissionError, getMembership } from "./permissions";
import {
  TeamError,
  createTeam,
  getTeamBySlug,
  listMembers,
  listTeamsForUser,
  renameTeam,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[teams/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户，避免每个用例都走 argon2 哈希。 */
async function createUser(db: DbClient, username: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, uid: generateUid(), username, passwordHash: "test-hash" });
  return { id };
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

  it("新建团队的 joinCode 非空、8 位", async () => {
    const owner = await createUser(db, "alice");

    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);

    // Team 领域模型暂不暴露 joinCode，直接查库校验。
    const [row] = await db.select().from(teams).where(eq(teams.id, team.id));
    expect(row!.joinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
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

  it("保留字 personal：团队名 Personal 落到 personal-2，不占用空间保留 slug", async () => {
    const owner = await createUser(db, "alice");

    const team = await createTeam({ name: "Personal" }, owner.id, db);

    expect(team.slug).not.toBe("personal");
    expect(team.slug).toBe("personal-2");
  });

  it("普通团队名不受保留字影响：slug 仍为名称推导结果", async () => {
    const owner = await createUser(db, "alice");

    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);

    expect(team.slug).toBe("growth-squad");
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
    // MySQL TIMESTAMP 秒级精度：同秒创建会并列，显式错开创建时间固定排序语义。
    await db
      .update(teams)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(teams.id, first.id));
    await db
      .update(teams)
      .set({ createdAt: new Date("2026-01-01T00:00:01Z") })
      .where(eq(teams.id, second.id));

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

  it("getMembership：命中返回成员关系，未加入返回 null", async () => {
    const owner = await createUser(db, "alice");
    const outsider = await createUser(db, "outsider");
    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);

    const membership = await getMembership(team.id, owner.id, db);
    expect(membership).toMatchObject({ teamId: team.id, userId: owner.id, role: "owner" });
    expect(await getMembership(team.id, outsider.id, db)).toBeNull();
  });

  it("renameTeam：owner/admin 可改名且 slug 不变，member 与非成员被拒", async () => {
    const owner = await createUser(db, "owner");
    const member = await createUser(db, "member");
    const outsider = await createUser(db, "outsider");
    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);
    await db.insert(teamMemberships).values({ teamId: team.id, userId: member.id, role: "member" });

    const renamed = await renameTeam({ teamId: team.id, actorId: owner.id, name: "增长突击队" }, db);
    expect(renamed.name).toBe("增长突击队");
    expect(renamed.slug).toBe(team.slug);

    await expect(
      renameTeam({ teamId: team.id, actorId: member.id, name: "Again" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
    await expect(
      renameTeam({ teamId: team.id, actorId: outsider.id, name: "Again" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("renameTeam：改名沿用团队名校验", async () => {
    const owner = await createUser(db, "owner");
    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);

    await expect(
      renameTeam({ teamId: team.id, actorId: owner.id, name: "团" }, db),
    ).rejects.toMatchObject({ code: "VALIDATION", field: "name" });
  });

  it("listMembers：返回成员视图并按加入时间升序", async () => {
    const owner = await createUser(db, "owner");
    const member = await createUser(db, "member");
    const team = await createTeam({ name: "Growth Squad" }, owner.id, db);
    // MySQL TIMESTAMP 默认秒级精度：两条成员关系若都取默认时间会并列，
    // 排序不稳定。以 owner 的加入时间为基准显式错开一秒，固定夹具语义。
    const ownerMembership = await getMembership(team.id, owner.id, db);
    await db.insert(teamMemberships).values({
      teamId: team.id,
      userId: member.id,
      role: "member",
      joinedAt: new Date(new Date(ownerMembership!.joinedAt).getTime() + 1000),
    });

    const members = await listMembers(team.id, db);

    expect(members.map((view) => view.user.username)).toEqual(["owner", "member"]);
    expect(members[0]).toMatchObject({
      membership: { role: "owner", teamId: team.id },
      user: { id: owner.id, username: "owner", uid: expect.stringMatching(/^doing_/) },
    });
  });
});
