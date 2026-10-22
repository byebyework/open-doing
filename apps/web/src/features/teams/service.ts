import { and, asc, eq, like } from "drizzle-orm";
import type { Team, TeamMembership } from "@open-doing/types";

import { slugWithCounter, slugifyName } from "@/lib/slug";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { teamMemberships, teams } from "@/server/db/schema";

/** slug 计数探测上限与唯一冲突重试上限。 */
const MAX_SLUG_SCAN = 50;
const MAX_SLUG_ATTEMPTS = 5;

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 30;

export type TeamErrorCode = "VALIDATION" | "SLUG_FAILED";

export type TeamErrorField = "name" | "form";

/** 创建团队入参。 */
export interface CreateTeamInput {
  name: string;
}

/**
 * 团队领域错误。
 *
 * `field` 供 Server Action 映射为表单字段错误；不把数据库细节泄露给客户端。
 */
export class TeamError extends Error {
  readonly code: TeamErrorCode;
  readonly field: TeamErrorField;

  constructor(code: TeamErrorCode, message: string, field: TeamErrorField = "form") {
    super(message);
    this.name = "TeamError";
    this.code = code;
    this.field = field;
  }
}

/** 行 -> 领域对象（时间转 ISO 字符串，保证可序列化）。 */
function toTeam(row: typeof teams.$inferSelect): Team {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMembership(row: typeof teamMemberships.$inferSelect): TeamMembership {
  return {
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/** 创建团队入参校验：名称 trim 后 2–30 字符。 */
function validateName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";

  if (!trimmed) {
    throw new TeamError("VALIDATION", "请输入团队名称", "name");
  }
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new TeamError(
      "VALIDATION",
      `团队名称需为 ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} 个字符`,
      "name",
    );
  }

  return trimmed;
}

/**
 * 在给定 client 内为 base slug 找一个空闲计数后缀。
 *
 * 先按 `like(base + '%')` 扫描已有 slug 取空闲计数，再由外层
 * 唯一约束 23505 重试兜底并发竞态。
 */
async function nextFreeSlug(base: string, client: DbClient): Promise<string> {
  const rows = await client
    .select({ slug: teams.slug })
    .from(teams)
    .where(like(teams.slug, `${base}%`));

  const taken = new Set(rows.map((row) => row.slug));
  for (let n = 1; n <= MAX_SLUG_SCAN; n += 1) {
    const candidate = slugWithCounter(base, n);
    if (!taken.has(candidate)) return candidate;
  }

  throw new TeamError("SLUG_FAILED", "团队地址生成失败，请稍后重试", "form");
}

/**
 * 创建团队：创建者自动成为 owner，团队与成员关系同事务写入。
 *
 * slug 由名称推导（纯中文回退 `team`），重名追加计数后缀；
 * 并发竞态由唯一约束重试兜底。
 */
export async function createTeam(
  input: CreateTeamInput,
  actorId: string,
  client: DbClient = db,
): Promise<Team> {
  const name = validateName(input?.name);
  const base = slugifyName(name);

  const attemptInsert = async (tx: DbClient): Promise<Team> => {
    const slug = await nextFreeSlug(base, tx);
    const [teamRow] = await tx
      .insert(teams)
      .values({ name, slug, ownerId: actorId })
      .returning();

    await tx.insert(teamMemberships).values({
      teamId: teamRow!.id,
      userId: actorId,
      role: "owner",
    });

    return toTeam(teamRow!);
  };

  // 已在事务内（嵌套调用）时直接复用，避免重复开事务。
  if (client !== db) {
    return attemptInsert(client);
  }

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(attemptInsert);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // slug 并发冲突：重扫计数后重试。
    }
  }

  throw new TeamError("SLUG_FAILED", "团队地址生成失败，请稍后重试", "form");
}

/** 按 slug 查团队，未命中返回 null（调用方决定 404 语义）。 */
export async function getTeamBySlug(
  slug: string,
  client: DbClient = db,
): Promise<Team | null> {
  const [row] = await client.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  return row ? toTeam(row) : null;
}

/** 用户所在的全部团队，按创建时间升序（侧栏「我的团队」数据源）。 */
export async function listTeamsForUser(
  userId: string,
  client: DbClient = db,
): Promise<Team[]> {
  const rows = await client
    .select({ team: teams })
    .from(teams)
    .innerJoin(teamMemberships, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, userId))
    .orderBy(asc(teams.createdAt));

  return rows.map((row) => toTeam(row.team));
}

/** 查询成员关系，未加入返回 null（权限判定层 T-4 消费）。 */
export async function getTeamMembership(
  teamId: string,
  userId: string,
  client: DbClient = db,
): Promise<TeamMembership | null> {
  const [row] = await client
    .select()
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
    .limit(1);
  return row ? toMembership(row) : null;
}
