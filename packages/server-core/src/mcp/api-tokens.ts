import { createHash, randomBytes } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";
import type { Team, VirtualMember } from "@open-doing/types";

import { db, type DbClient } from "../db/client";
import { apiTokens, teams, users, virtualMembers } from "../db/schema";

import { assertCan, getMembership } from "../teams/permissions";
import { VirtualMemberError } from "../virtual/service";

/**
 * API Token 服务（MCP 接入）。
 *
 * - 签发/吊销的鉴权与虚拟成员写操作一致：目标虚拟成员所在团队的 owner/admin
 *   （`getMembership` + `assertCan("team:remove_member")`），且团队必须是虚拟团队。
 * - Token 原文只在 `issueApiToken` 返回一次，库中仅存 sha256 hash 与 8 位展示前缀；
 *   任何日志都不得输出原文。
 * - 解析失败（格式非法、查无、签发者被禁用）统一返回 null，不区分失败原因。
 */

/** 原文固定前缀（与 `api_tokens` 表的展示前缀约定一致）。 */
const TOKEN_PREFIX = "odm_";
/** 32 字节熵的 base62 编码长度（62^43 > 2^256，恰好可容纳）。 */
const TOKEN_BODY_LENGTH = 43;
/** 展示用前缀长度：`odm_` + 4 位随机字符。 */
const DISPLAY_PREFIX_LENGTH = 8;
/** base62 字母表：数字 + 大写 + 小写（43 位定长编码）。 */
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** tsconfig target 为 ES2017，不能使用 `0n` 字面量，统一用 BigInt() 构造。 */
const BIGINT_ZERO = BigInt(0);
const BIGINT_EIGHT = BigInt(8);
const BIGINT_BASE = BigInt(62);

export interface IssueApiTokenInput {
  virtualMemberId: string;
  actorId: string;
}

export interface RevokeApiTokenInput {
  virtualMemberId: string;
  actorId: string;
}

/** 管理界面展示用的 Token 摘要（原文绝不进入该结构）。 */
export interface ApiTokenSummary {
  virtualMemberId: string;
  tokenPrefix: string;
  /** 最近使用时刻（ISO 字符串）；从未使用为 null。 */
  lastUsedAt: string | null;
}

/** Token 解析结果：签发者 + 被代理的虚拟成员 + 所属团队。 */
export interface ApiTokenContext {
  user: { id: string; name: string };
  virtualMember: VirtualMember;
  team: Team;
}

/**
 * 32 字节随机熵 → 定长 43 位 base62。
 *
 * 采用 BigInt 逐位取模，不引入额外依赖；不足 43 位时左侧补 `0`。
 */
function base62Encode(bytes: Buffer): string {
  let value = BIGINT_ZERO;
  for (const byte of bytes) {
    value = (value << BIGINT_EIGHT) | BigInt(byte);
  }

  let encoded = "";
  while (value > BIGINT_ZERO) {
    encoded = BASE62_ALPHABET[Number(value % BIGINT_BASE)]! + encoded;
    value /= BIGINT_BASE;
  }

  return encoded.padStart(TOKEN_BODY_LENGTH, BASE62_ALPHABET[0]);
}

/** 生成一次性的明文 Token（仅调用方可见，绝不落库）。 */
function generateApiToken(): string {
  return `${TOKEN_PREFIX}${base62Encode(randomBytes(32))}`;
}

/** 库中存储的 token 指纹：完整原文的 sha256 hex。 */
function hashApiToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * 签发/吊销共用的鉴权：虚拟成员必须存在，操作者必须是其团队 owner/admin，
 * 且团队必须是虚拟团队。错误类型/keys 与 `features/teams/virtual/service.ts` 保持一致。
 */
async function assertCanManageVirtualMember(
  virtualMemberId: string,
  actorId: string,
  client: DbClient,
): Promise<void> {
  const [row] = await client
    .select({
      teamId: virtualMembers.teamId,
      teamKind: teams.kind,
    })
    .from(virtualMembers)
    .innerJoin(teams, eq(virtualMembers.teamId, teams.id))
    .where(eq(virtualMembers.id, virtualMemberId))
    .limit(1);

  if (!row) {
    throw new VirtualMemberError("VALIDATION", "虚拟成员不存在或已移除", "form", {
      key: "virtualMemberNotFound",
    });
  }

  const membership = await getMembership(row.teamId, actorId, client);
  assertCan(membership?.role ?? null, "team:remove_member");

  if (row.teamKind !== "virtual") {
    throw new VirtualMemberError("VALIDATION", "虚拟成员只能存在于虚拟团队", "form", {
      key: "virtualTeamOnly",
    });
  }
}

/**
 * 签发 Token（重签即轮换：先删除同一虚拟成员的旧行，再写入新 hash）。
 *
 * 返回的 `token` 是唯一一次可见的原文；`tokenPrefix` 供管理界面展示。
 */
export async function issueApiToken(
  input: IssueApiTokenInput,
  client: DbClient = db,
): Promise<{ token: string; tokenPrefix: string }> {
  await assertCanManageVirtualMember(input.virtualMemberId, input.actorId, client);

  const token = generateApiToken();
  const tokenPrefix = token.slice(0, DISPLAY_PREFIX_LENGTH);

  // 唯一约束（virtual_member_id）保证同一虚拟成员最多一行；先删后插完成轮换。
  await client.delete(apiTokens).where(eq(apiTokens.virtualMemberId, input.virtualMemberId));
  await client.insert(apiTokens).values({
    userId: input.actorId,
    virtualMemberId: input.virtualMemberId,
    tokenHash: hashApiToken(token),
    tokenPrefix,
  });

  return { token, tokenPrefix };
}

/**
 * 吊销 Token：直接删除该虚拟成员的行；本来就没有 Token 也算成功。
 */
export async function revokeApiToken(
  input: RevokeApiTokenInput,
  client: DbClient = db,
): Promise<void> {
  await assertCanManageVirtualMember(input.virtualMemberId, input.actorId, client);

  await client.delete(apiTokens).where(eq(apiTokens.virtualMemberId, input.virtualMemberId));
}

/**
 * 团队内 Token 只读列表（管理界面用）。
 *
 * 仅返回展示前缀与最近使用时间，绝不查询 / 返回 hash 或原文；按虚拟成员
 * 创建顺序排序。调用方（设置页）已通过团队 membership 校验后才可达。
 */
export async function listApiTokens(
  teamId: string,
  client: DbClient = db,
): Promise<ApiTokenSummary[]> {
  const rows = await client
    .select({
      virtualMemberId: apiTokens.virtualMemberId,
      tokenPrefix: apiTokens.tokenPrefix,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .innerJoin(virtualMembers, eq(apiTokens.virtualMemberId, virtualMembers.id))
    .where(eq(virtualMembers.teamId, teamId))
    .orderBy(asc(virtualMembers.createdAt));

  return rows.map((row) => ({
    virtualMemberId: row.virtualMemberId,
    tokenPrefix: row.tokenPrefix,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }));
}

/**
 * 解析 Bearer Token → ApiTokenContext。
 *
 * null / 缺少 `odm_` 前缀 / hash 查无 / 签发者已禁用 一律返回 null。
 * 命中时尽力更新 `last_used_at`，更新时间失败不影响解析结果。
 */
export async function resolveApiToken(
  rawToken: string | null,
  client: DbClient = db,
): Promise<ApiTokenContext | null> {
  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) return null;

  const [row] = await client
    .select({
      tokenId: apiTokens.id,
      userId: users.id,
      userName: users.name,
      userIsDisabled: users.isDisabled,
      virtualMemberId: virtualMembers.id,
      virtualMemberTeamId: virtualMembers.teamId,
      virtualMemberName: virtualMembers.name,
      virtualMemberRole: virtualMembers.role,
      virtualMemberDescription: virtualMembers.description,
      virtualMemberAccentColor: virtualMembers.accentColor,
      virtualMemberCreatedAt: virtualMembers.createdAt,
      teamId: teams.id,
      teamName: teams.name,
      teamSlug: teams.slug,
      teamKind: teams.kind,
      teamOwnerId: teams.ownerId,
      teamCreatedAt: teams.createdAt,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .innerJoin(virtualMembers, eq(apiTokens.virtualMemberId, virtualMembers.id))
    .innerJoin(teams, eq(virtualMembers.teamId, teams.id))
    .where(eq(apiTokens.tokenHash, hashApiToken(rawToken)))
    .limit(1);

  if (!row || row.userIsDisabled) return null;

  try {
    await client
      .update(apiTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiTokens.id, row.tokenId));
  } catch {
    // 记录最近使用时间是尽力而为：失败不得阻断 Token 解析。
  }

  const virtualMember: VirtualMember = {
    id: row.virtualMemberId,
    teamId: row.virtualMemberTeamId,
    name: row.virtualMemberName,
    role: row.virtualMemberRole,
    description: row.virtualMemberDescription ?? undefined,
    accentColor: row.virtualMemberAccentColor,
    createdAt: row.virtualMemberCreatedAt.toISOString(),
  };

  const team: Team = {
    id: row.teamId,
    name: row.teamName,
    slug: row.teamSlug,
    kind: row.teamKind,
    ownerId: row.teamOwnerId,
    createdAt: row.teamCreatedAt.toISOString(),
  };

  return {
    user: { id: row.userId, name: row.userName },
    virtualMember,
    team,
  };
}
