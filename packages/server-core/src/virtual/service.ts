import { and, asc, eq } from "drizzle-orm";
import type { VirtualMember } from "@open-doing/types";

import type { DomainErrorI18n } from "../lib/domain-error";
import { db, type DbClient } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { teams, virtualMembers } from "../db/schema";

import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "../teams/constants";
import { assertCan, getMembership } from "../teams/permissions";
import type { TeamErrorCode, TeamErrorField } from "../teams/service";

/**
 * 虚拟成员领域错误（与 `TeamError` 同构）。
 *
 * `field` 供 Server Action 映射为表单字段错误；`i18n` 为可选翻译通道，
 * `message` 保持 zh 兜底，携带 i18n 时由 action 按请求语言翻译。
 */
/** 虚拟成员错误可落的字段：角色校验额外引入 `role`。 */
export type VirtualMemberErrorField = TeamErrorField | "role";

export class VirtualMemberError extends Error {
  readonly code: TeamErrorCode;
  readonly field: VirtualMemberErrorField;
  readonly i18n?: DomainErrorI18n;

  constructor(
    code: TeamErrorCode,
    message: string,
    field: VirtualMemberErrorField = "form",
    i18n?: DomainErrorI18n,
  ) {
    super(message);
    this.name = "VirtualMemberError";
    this.code = code;
    this.field = field;
    this.i18n = i18n;
  }
}

export interface CreateVirtualMemberInput {
  teamId: string;
  actorId: string;
  name: string;
  role?: "admin" | "member";
  description?: string;
  accentColor?: string;
}

export interface UpdateVirtualMemberInput {
  teamId: string;
  virtualMemberId: string;
  actorId: string;
  name?: string;
  role?: "admin" | "member";
  description?: string;
  accentColor?: string;
}

export interface RemoveVirtualMemberInput {
  teamId: string;
  virtualMemberId: string;
  actorId: string;
}

/** 行 -> 领域对象（时间转 ISO 字符串，保证可序列化）。 */
function toVirtualMember(row: typeof virtualMembers.$inferSelect): VirtualMember {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    role: row.role,
    description: row.description ?? undefined,
    accentColor: row.accentColor,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 名称校验：trim 后 2–`NAME_MAX_LENGTH` 字符（与团队名称同一套限长常量）。 */
function validateName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";

  if (!trimmed) {
    throw new VirtualMemberError("VALIDATION", "请输入虚拟成员名称", "name", {
      key: "virtualMemberNameRequired",
    });
  }
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new VirtualMemberError(
      "VALIDATION",
      `虚拟成员名称需为 ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} 个字符`,
      "name",
      {
        key: "virtualMemberNameLength",
        params: { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH },
      },
    );
  }

  return trimmed;
}

/**
 * 角色运行时校验：Server Action 入参在运行时可能被伪造，
 * 只接受 admin / member（owner 属于真人团队成员关系，不得写入虚拟成员）。
 */
function validateRole(role: unknown): "admin" | "member" | undefined {
  if (role === undefined) return undefined;
  if (role !== "admin" && role !== "member") {
    throw new VirtualMemberError("VALIDATION", "虚拟成员角色无效", "role", {
      key: "virtualMemberRoleInvalid",
    });
  }
  return role;
}

/** 说明归一化：仅空白视为未填写（存 null），其余 trim 后落库。 */
function normalizeDescription(description: unknown): string | null {
  if (typeof description !== "string") return null;
  const trimmed = description.trim();
  return trimmed ? trimmed : null;
}

/** 三个写操作共用的鉴权：owner/admin 才有虚拟成员管理权（同移除成员）。 */
async function assertCanManage(
  teamId: string,
  actorId: string,
  client: DbClient,
): Promise<void> {
  const membership = await getMembership(teamId, actorId, client);
  assertCan(membership?.role ?? null, "team:remove_member");
}

/**
 * 虚拟成员只能存在于虚拟团队：真实团队一律拒绝（`virtualTeamOnly`）。
 * 团队不存在时同样抛领域错误，避免泄露内部细节。
 */
async function assertTeamIsVirtual(teamId: string, client: DbClient): Promise<void> {
  const [row] = await client
    .select({ kind: teams.kind })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!row) {
    throw new VirtualMemberError("VALIDATION", "团队不存在", "form", {
      key: "teamNotFound",
    });
  }
  if (row.kind !== "virtual") {
    throw new VirtualMemberError("VALIDATION", "虚拟成员只能存在于虚拟团队", "form", {
      key: "virtualTeamOnly",
    });
  }
}

/** 团队内重名统一映射为 name 字段错误。 */
function duplicateNameError(): VirtualMemberError {
  return new VirtualMemberError(
    "VALIDATION",
    "该团队已存在同名虚拟成员",
    "name",
    { key: "virtualMemberNameDuplicate" },
  );
}

/** 目标虚拟成员不存在、或不属于给定团队。 */
function notFoundError(): VirtualMemberError {
  return new VirtualMemberError("VALIDATION", "虚拟成员不存在或已移除", "form", {
    key: "virtualMemberNotFound",
  });
}

/**
 * 创建虚拟成员（owner/admin；仅虚拟团队）。
 *
 * 名称 trim 后 2–30 字符；团队内重名由唯一约束兜底并映射为 name 字段错误。
 */
export async function createVirtualMember(
  input: CreateVirtualMemberInput,
  client: DbClient = db,
): Promise<VirtualMember> {
  await assertCanManage(input.teamId, input.actorId, client);
  await assertTeamIsVirtual(input.teamId, client);

  const name = validateName(input.name);

  try {
    const [row] = await client
      .insert(virtualMembers)
      .values({
        teamId: input.teamId,
        name,
        role: validateRole(input.role) ?? "member",
        description: normalizeDescription(input.description),
        accentColor: input.accentColor ?? null,
        createdById: input.actorId,
      })
      .returning();

    return toVirtualMember(row!);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateNameError();
    }
    throw error;
  }
}

/**
 * 更新虚拟成员（owner/admin；仅虚拟团队）。
 *
 * 只写入显式提供的字段；名称同样先 trim 校验，重名映射为 name 字段错误。
 */
export async function updateVirtualMember(
  input: UpdateVirtualMemberInput,
  client: DbClient = db,
): Promise<VirtualMember> {
  await assertCanManage(input.teamId, input.actorId, client);
  await assertTeamIsVirtual(input.teamId, client);

  const changes: Partial<typeof virtualMembers.$inferInsert> = {};
  if (input.name !== undefined) changes.name = validateName(input.name);
  const role = validateRole(input.role);
  if (role !== undefined) changes.role = role;
  if (input.description !== undefined) {
    changes.description = normalizeDescription(input.description);
  }
  if (input.accentColor !== undefined) changes.accentColor = input.accentColor;

  // 没有可写字段时仅校验成员存在性，避免空 SET。
  if (Object.keys(changes).length === 0) {
    const [row] = await client
      .select()
      .from(virtualMembers)
      .where(and(eq(virtualMembers.id, input.virtualMemberId), eq(virtualMembers.teamId, input.teamId)))
      .limit(1);
    if (!row) throw notFoundError();
    return toVirtualMember(row);
  }

  try {
    const [row] = await client
      .update(virtualMembers)
      .set(changes)
      .where(
        and(eq(virtualMembers.id, input.virtualMemberId), eq(virtualMembers.teamId, input.teamId)),
      )
      .returning();

    if (!row) throw notFoundError();
    return toVirtualMember(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateNameError();
    }
    throw error;
  }
}

/**
 * 移除虚拟成员（owner/admin；仅虚拟团队）。
 *
 * where 同时限定 teamId，跨团队 id 视同不存在。
 */
export async function removeVirtualMember(
  input: RemoveVirtualMemberInput,
  client: DbClient = db,
): Promise<void> {
  await assertCanManage(input.teamId, input.actorId, client);
  await assertTeamIsVirtual(input.teamId, client);

  const deleted = await client
    .delete(virtualMembers)
    .where(
      and(eq(virtualMembers.id, input.virtualMemberId), eq(virtualMembers.teamId, input.teamId)),
    )
    .returning({ id: virtualMembers.id });

  if (deleted.length === 0) throw notFoundError();
}

/** 团队虚拟成员只读列表，按创建时间升序。 */
export async function listVirtualMembers(
  teamId: string,
  client: DbClient = db,
): Promise<VirtualMember[]> {
  const rows = await client
    .select()
    .from(virtualMembers)
    .where(eq(virtualMembers.teamId, teamId))
    .orderBy(asc(virtualMembers.createdAt));

  return rows.map(toVirtualMember);
}
