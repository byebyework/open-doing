import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { apiTokens, teamMemberships, users, virtualMembers } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TeamPermissionError } from "../teams/permissions";
import { createTeam } from "../teams/service";
import { VirtualMemberError, createVirtualMember } from "../teams/virtual/service";
import { issueApiToken, resolveApiToken, revokeApiToken } from "./api-tokens";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[mcp/api-tokens.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

const HASH = (token: string) => createHash("sha256").update(token).digest("hex");

async function createUser(db: DbClient, username: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    uid: generateUid(),
    username,
    name: username,
    email: `${id}@test.local`,
    displayUsername: username,
  });
  return { id };
}

/** 夹具：一个虚拟团队（owner/admin/member + 外人）、一个虚拟成员。 */
async function seedVirtualTeam(db: DbClient) {
  const owner = await createUser(db, "owner");
  const admin = await createUser(db, "admin");
  const member = await createUser(db, "member");
  const outsider = await createUser(db, "outsider");

  const virtual = await createTeam({ name: "Agent Squad", kind: "virtual" }, owner.id, db);
  await db.insert(teamMemberships).values([
    { teamId: virtual.id, userId: admin.id, role: "admin" },
    { teamId: virtual.id, userId: member.id, role: "member" },
  ]);

  const agent = await createVirtualMember(
    {
      teamId: virtual.id,
      actorId: owner.id,
      name: "写作助手",
      role: "admin",
      description: "负责周报",
      accentColor: "#a66b00",
    },
    db,
  );

  return { owner, admin, member, outsider, virtual, agent };
}

describe.skipIf(!hasTestDatabase)("api tokens service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("签发：返回 odm_ + 43 位 base62 原文，库中仅存 sha256 hash 与 8 位前缀", async () => {
    const { owner, agent } = await seedVirtualTeam(db);

    const issued = await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    expect(issued.token).toMatch(/^odm_[0-9A-Za-z]{43}$/);
    expect(issued.tokenPrefix).toHaveLength(8);
    expect(issued.tokenPrefix).toBe(issued.token.slice(0, 8));
    expect(issued.tokenPrefix.startsWith("odm_")).toBe(true);

    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.virtualMemberId, agent.id));
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.userId).toBe(owner.id);
    expect(row.tokenHash).toBe(HASH(issued.token));
    expect(row.tokenPrefix).toBe(issued.tokenPrefix);
    expect(row.lastUsedAt).toBeNull();

    // 原文绝不出现在任何列里（含 hash 列本身）。
    expect(row.tokenHash).not.toBe(issued.token);
    expect(JSON.stringify(row)).not.toContain(issued.token);
  });

  it("签发：admin 可签发；member / 外人被拒（TeamPermissionError）", async () => {
    const { admin, member, outsider, agent } = await seedVirtualTeam(db);

    await expect(
      issueApiToken({ virtualMemberId: agent.id, actorId: admin.id }, db),
    ).resolves.toMatchObject({ tokenPrefix: expect.any(String) });

    await expect(
      issueApiToken({ virtualMemberId: agent.id, actorId: member.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await expect(
      issueApiToken({ virtualMemberId: agent.id, actorId: outsider.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("签发：真实团队的虚拟成员被拒（virtualTeamOnly），不存在的成员被拒", async () => {
    const { owner } = await seedVirtualTeam(db);
    const real = await createTeam({ name: "Growth Squad" }, owner.id, db);
    const [realAgent] = await db
      .insert(virtualMembers)
      .values({
        teamId: real.id,
        name: "真实团队里的假成员",
        createdById: owner.id,
      })
      .returning();

    const realFailure = issueApiToken(
      { virtualMemberId: realAgent!.id, actorId: owner.id },
      db,
    );
    await expect(realFailure).rejects.toBeInstanceOf(VirtualMemberError);
    await expect(realFailure).rejects.toMatchObject({
      code: "VALIDATION",
      i18n: { key: "virtualTeamOnly" },
    });

    const missingFailure = issueApiToken(
      { virtualMemberId: crypto.randomUUID(), actorId: owner.id },
      db,
    );
    await expect(missingFailure).rejects.toBeInstanceOf(VirtualMemberError);
    await expect(missingFailure).rejects.toMatchObject({
      i18n: { key: "virtualMemberNotFound" },
    });
  });

  it("重签即轮换：旧原文解析为 null，新原文可用，库中仍只有一行", async () => {
    const { owner, agent } = await seedVirtualTeam(db);

    const first = await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);
    const second = await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    expect(second.token).not.toBe(first.token);
    expect(await resolveApiToken(first.token, db)).toBeNull();
    await expect(resolveApiToken(second.token, db)).resolves.not.toBeNull();

    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.virtualMemberId, agent.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(HASH(second.token));
  });

  it("吊销：删行后原文解析为 null；重复吊销也算成功", async () => {
    const { owner, agent } = await seedVirtualTeam(db);
    const issued = await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    await revokeApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    expect(await resolveApiToken(issued.token, db)).toBeNull();
    expect(
      await db.select().from(apiTokens).where(eq(apiTokens.virtualMemberId, agent.id)),
    ).toHaveLength(0);

    await expect(
      revokeApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db),
    ).resolves.toBeUndefined();
  });

  it("吊销：member / 外人 / 真实团队都被拒", async () => {
    const { owner, member, outsider, agent } = await seedVirtualTeam(db);
    await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    await expect(
      revokeApiToken({ virtualMemberId: agent.id, actorId: member.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
    await expect(
      revokeApiToken({ virtualMemberId: agent.id, actorId: outsider.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    const real = await createTeam({ name: "Growth Squad" }, owner.id, db);
    const [realAgent] = await db
      .insert(virtualMembers)
      .values({ teamId: real.id, name: "真实团队里的假成员", createdById: owner.id })
      .returning();
    await expect(
      revokeApiToken({ virtualMemberId: realAgent!.id, actorId: owner.id }, db),
    ).rejects.toMatchObject({ i18n: { key: "virtualTeamOnly" } });
  });

  it("解析：null / 无 odm_ 前缀 / 随机串 / 前缀正确但查无 → null", async () => {
    expect(await resolveApiToken(null, db)).toBeNull();
    expect(await resolveApiToken("", db)).toBeNull();
    expect(await resolveApiToken("garbage", db)).toBeNull();
    expect(await resolveApiToken("Bearer odm_xxx", db)).toBeNull();
    expect(await resolveApiToken(`odm_${"a".repeat(43)}`, db)).toBeNull();
  });

  it("解析：命中后返回完整三元组，并尽力更新 last_used_at", async () => {
    const { owner, virtual, agent } = await seedVirtualTeam(db);
    const issued = await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    const ctx = await resolveApiToken(issued.token, db);

    expect(ctx).not.toBeNull();
    expect(ctx).toMatchObject({
      user: { id: owner.id, name: "owner" },
      virtualMember: {
        id: agent.id,
        teamId: virtual.id,
        name: "写作助手",
        role: "admin",
        description: "负责周报",
        accentColor: "#a66b00",
      },
      team: {
        id: virtual.id,
        name: "Agent Squad",
        slug: virtual.slug,
        kind: "virtual",
        ownerId: owner.id,
      },
    });
    expect(ctx!.virtualMember.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);
    expect(ctx!.team.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);

    const [row] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.virtualMemberId, agent.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it("解析：签发者被禁用（users.is_disabled）→ null，且不记 last_used_at", async () => {
    const { owner, agent } = await seedVirtualTeam(db);
    const issued = await issueApiToken({ virtualMemberId: agent.id, actorId: owner.id }, db);

    await db.update(users).set({ isDisabled: true }).where(eq(users.id, owner.id));

    expect(await resolveApiToken(issued.token, db)).toBeNull();

    const [row] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.virtualMemberId, agent.id));
    expect(row!.lastUsedAt).toBeNull();
  });
});
