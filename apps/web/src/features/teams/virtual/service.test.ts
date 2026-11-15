import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { teamMemberships, virtualMembers, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "../constants";
import { TeamPermissionError } from "../permissions";
import { createTeam } from "../service";
import {
  VirtualMemberError,
  createVirtualMember,
  listVirtualMembers,
  removeVirtualMember,
  updateVirtualMember,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[teams/virtual/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

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

/**
 * 夹具：一个虚拟团队（owner/admin/member + 外人）与一个真实团队（外人创建）。
 * owner/admin 可写，member 与外人不可写；真实团队用于 virtualTeamOnly 守卫。
 */
async function seedTeams(db: DbClient) {
  const owner = await createUser(db, "owner");
  const admin = await createUser(db, "admin");
  const member = await createUser(db, "member");
  const outsider = await createUser(db, "outsider");

  const virtual = await createTeam({ name: "Agent Squad", kind: "virtual" }, owner.id, db);
  await db.insert(teamMemberships).values([
    { teamId: virtual.id, userId: admin.id, role: "admin" },
    { teamId: virtual.id, userId: member.id, role: "member" },
  ]);

  const real = await createTeam({ name: "Growth Squad" }, outsider.id, db);

  return { owner, admin, member, outsider, virtual, real };
}

describe.skipIf(!hasTestDatabase)("虚拟成员 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("创建：默认角色 member，字段完整且时间为 ISO 字符串", async () => {
    const { owner, virtual } = await seedTeams(db);

    const created = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "  写作助手  " },
      db,
    );

    expect(created).toMatchObject({
      teamId: virtual.id,
      name: "写作助手",
      role: "member",
      description: undefined,
      accentColor: null,
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);

    // 审计字段 createdById 落为调用者。
    const [row] = await db
      .select()
      .from(virtualMembers)
      .where(eq(virtualMembers.id, created.id));
    expect(row!.createdById).toBe(owner.id);
  });

  it("创建：admin 可创建，显式角色 / 说明 / 头像色均落库", async () => {
    const { admin, virtual } = await seedTeams(db);

    const created = await createVirtualMember(
      {
        teamId: virtual.id,
        actorId: admin.id,
        name: "写作助手",
        role: "admin",
        description: "负责周报",
        accentColor: "#a66b00",
      },
      db,
    );

    expect(created).toMatchObject({
      name: "写作助手",
      role: "admin",
      description: "负责周报",
      accentColor: "#a66b00",
    });
  });

  it("非 owner/admin 成员与外部用户写操作抛权限错误", async () => {
    const { owner, member, outsider, virtual } = await seedTeams(db);
    const target = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手" },
      db,
    );

    await expect(
      createVirtualMember({ teamId: virtual.id, actorId: member.id, name: "新成员" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
    await expect(
      updateVirtualMember(
        { teamId: virtual.id, virtualMemberId: target.id, actorId: member.id, name: "改名" },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);
    await expect(
      removeVirtualMember(
        { teamId: virtual.id, virtualMemberId: target.id, actorId: member.id },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await expect(
      createVirtualMember({ teamId: virtual.id, actorId: outsider.id, name: "新成员" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("真实团队拒绝添加 / 更新 / 移除虚拟成员（virtualTeamOnly）", async () => {
    const { owner, outsider, virtual, real } = await seedTeams(db);
    const target = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手" },
      db,
    );

    await expect(
      createVirtualMember({ teamId: real.id, actorId: outsider.id, name: "写作助手" }, db),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "form",
      i18n: { key: "virtualTeamOnly" },
    });
    await expect(
      updateVirtualMember(
        { teamId: real.id, virtualMemberId: target.id, actorId: outsider.id, name: "改名" },
        db,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "form",
      i18n: { key: "virtualTeamOnly" },
    });
    await expect(
      removeVirtualMember(
        { teamId: real.id, virtualMemberId: target.id, actorId: outsider.id },
        db,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "form",
      i18n: { key: "virtualTeamOnly" },
    });
  });

  it("团队内重名：创建与改名为已有名称均落 name 字段", async () => {
    const { owner, virtual } = await seedTeams(db);
    await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手" },
      db,
    );
    const second = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "绘图助手" },
      db,
    );

    await expect(
      createVirtualMember({ teamId: virtual.id, actorId: owner.id, name: "写作助手" }, db),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
      i18n: { key: "virtualMemberNameDuplicate" },
    });
    await expect(
      updateVirtualMember(
        { teamId: virtual.id, virtualMemberId: second.id, actorId: owner.id, name: "写作助手" },
        db,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
      i18n: { key: "virtualMemberNameDuplicate" },
    });
  });

  it("名称校验：空白 / 短于下限 / 超长分别落 name 字段错误（虚拟成员专用文案 key）", async () => {
    const { owner, virtual } = await seedTeams(db);

    await expect(
      createVirtualMember({ teamId: virtual.id, actorId: owner.id, name: "   " }, db),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
      i18n: { key: "virtualMemberNameRequired" },
    });

    await expect(
      createVirtualMember({ teamId: virtual.id, actorId: owner.id, name: " A " }, db),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
      i18n: {
        key: "virtualMemberNameLength",
        params: { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH },
      },
    });

    const tooLong = "长".repeat(NAME_MAX_LENGTH + 1);
    await expect(
      createVirtualMember({ teamId: virtual.id, actorId: owner.id, name: tooLong }, db),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "name",
      i18n: {
        key: "virtualMemberNameLength",
        params: { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH },
      },
    });
  });

  it("角色运行时校验：create / update 只接受 admin|member，owner 等取值一律拒绝且不落库", async () => {
    const { owner, virtual } = await seedTeams(db);
    const created = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手" },
      db,
    );

    // 绕过 TS 类型（Server Action 入参在运行时可能被伪造）。
    await expect(
      createVirtualMember(
        { teamId: virtual.id, actorId: owner.id, name: "写作助手二号", role: "owner" as never },
        db,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "role",
      i18n: { key: "virtualMemberRoleInvalid" },
    });
    await expect(
      updateVirtualMember(
        { teamId: virtual.id, virtualMemberId: created.id, actorId: owner.id, role: "owner" as never },
        db,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "role",
      i18n: { key: "virtualMemberRoleInvalid" },
    });

    // 非法 create / update 都不得写入：成员数量与角色保持原状。
    expect(await listVirtualMembers(virtual.id, db)).toHaveLength(1);
    const [row] = await db
      .select()
      .from(virtualMembers)
      .where(eq(virtualMembers.id, created.id));
    expect(row!.role).toBe("member");
  });

  it("说明归一化：空白输入存 null，正常输入 trim 后落库", async () => {
    const { owner, virtual } = await seedTeams(db);

    const blank = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手", description: "   " },
      db,
    );
    expect(blank.description).toBeUndefined();

    const trimmed = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "绘图助手", description: "  负责配图  " },
      db,
    );
    expect(trimmed.description).toBe("负责配图");

    // 更新为空说明时同样回到 null（领域对象呈现为 undefined）。
    const cleared = await updateVirtualMember(
      { teamId: virtual.id, virtualMemberId: trimmed.id, actorId: owner.id, description: " \n " },
      db,
    );
    expect(cleared.description).toBeUndefined();
    const [row] = await db
      .select()
      .from(virtualMembers)
      .where(eq(virtualMembers.id, trimmed.id));
    expect(row!.description).toBeNull();
  });

  it("更新：只改提供的字段，其余保持原值", async () => {
    const { owner, virtual } = await seedTeams(db);
    const created = await createVirtualMember(
      {
        teamId: virtual.id,
        actorId: owner.id,
        name: "写作助手",
        description: "负责周报",
        accentColor: "#a66b00",
      },
      db,
    );

    const updated = await updateVirtualMember(
      { teamId: virtual.id, virtualMemberId: created.id, actorId: owner.id, role: "admin" },
      db,
    );

    expect(updated).toMatchObject({
      id: created.id,
      name: "写作助手",
      role: "admin",
      description: "负责周报",
      accentColor: "#a66b00",
      createdAt: created.createdAt,
    });

    const renamed = await updateVirtualMember(
      {
        teamId: virtual.id,
        virtualMemberId: created.id,
        actorId: owner.id,
        name: "  写作机器人  ",
        description: "负责日报",
        accentColor: "#0b6fb8",
      },
      db,
    );
    expect(renamed).toMatchObject({
      name: "写作机器人",
      role: "admin",
      description: "负责日报",
      accentColor: "#0b6fb8",
    });
  });

  it("更新 / 移除：不存在的成员或跨团队 id 一律按未找到拒绝", async () => {
    const { owner, outsider, virtual } = await seedTeams(db);
    const otherVirtual = await createTeam({ name: "Other Agents", kind: "virtual" }, outsider.id, db);
    const foreign = await createVirtualMember(
      { teamId: otherVirtual.id, actorId: outsider.id, name: "外部助手" },
      db,
    );

    await expect(
      updateVirtualMember(
        { teamId: virtual.id, virtualMemberId: crypto.randomUUID(), actorId: owner.id, name: "改名" },
        db,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      field: "form",
      i18n: { key: "virtualMemberNotFound" },
    });
    await expect(
      updateVirtualMember(
        { teamId: virtual.id, virtualMemberId: foreign.id, actorId: owner.id, name: "改名" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "virtualMemberNotFound" } });
    await expect(
      removeVirtualMember({ teamId: virtual.id, virtualMemberId: foreign.id, actorId: owner.id }, db),
    ).rejects.toMatchObject({ i18n: { key: "virtualMemberNotFound" } });

    // 跨团队拒绝不得误删外部团队的成员。
    const foreignRows = await db
      .select()
      .from(virtualMembers)
      .where(eq(virtualMembers.id, foreign.id));
    expect(foreignRows).toHaveLength(1);
  });

  it("列表：只返回本团队虚拟成员，按创建时间升序", async () => {
    const { owner, outsider, virtual } = await seedTeams(db);
    const first = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手" },
      db,
    );
    const second = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "绘图助手" },
      db,
    );

    const otherVirtual = await createTeam({ name: "Other Agents", kind: "virtual" }, outsider.id, db);
    await createVirtualMember(
      { teamId: otherVirtual.id, actorId: outsider.id, name: "外部助手" },
      db,
    );

    const list = await listVirtualMembers(virtual.id, db);

    expect(list.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(list.map((item) => item.name)).toEqual(["写作助手", "绘图助手"]);
  });

  it("移除：删除行并从列表中消失", async () => {
    const { owner, virtual } = await seedTeams(db);
    const created = await createVirtualMember(
      { teamId: virtual.id, actorId: owner.id, name: "写作助手" },
      db,
    );

    await removeVirtualMember(
      { teamId: virtual.id, virtualMemberId: created.id, actorId: owner.id },
      db,
    );

    expect(await listVirtualMembers(virtual.id, db)).toEqual([]);
  });

  it("VirtualMemberError 与 TeamError 同构（code / field / i18n / name）", () => {
    const error = new VirtualMemberError(
      "VALIDATION",
      "该团队已存在同名虚拟成员",
      "name",
      { key: "virtualMemberNameDuplicate" },
    );

    expect(error.name).toBe("VirtualMemberError");
    expect(error.code).toBe("VALIDATION");
    expect(error.field).toBe("name");
    expect(error.i18n).toEqual({ key: "virtualMemberNameDuplicate" });
  });
});
