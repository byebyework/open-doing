import type { Project } from "@open-doing/types";
import { and, asc, eq, inArray } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import { generateUniqueSlug } from "@/lib/slug";
import type { DbClient } from "@/server/db/client";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { assertCan, getMembership } from "@/features/teams/permissions";

/** 项目名称长度上限（与表单校验一致）。 */
export const PROJECT_NAME_MAX_LENGTH = 50;

/** 项目描述长度上限（与表单校验一致）。 */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

type ProjectRow = typeof projects.$inferSelect;

/** 数据库行 -> 可跨边界传递的领域 Project（时间统一为 ISO 字符串）。 */
function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    teamId: row.teamId,
    ownerId: row.ownerId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function validateName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";

  if (!name) {
    throw new DomainError("请输入项目名称", "name");
  }
  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    throw new DomainError(
      `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`,
      "name",
    );
  }

  return name;
}

/** 描述清空统一存 null，读取时映射为 undefined。 */
function validateDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const description = value.trim();
  if (!description) return null;
  if (description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      `描述不能超过 ${PROJECT_DESCRIPTION_MAX_LENGTH} 个字符`,
      "description",
    );
  }

  return description;
}

/**
 * 断言操作者可在该团队管理项目（owner/admin），返回其角色。
 *
 * 非成员与 member 统一抛 `TeamPermissionError`（可映射 403），
 * 不向调用方区分「团队不存在」与「无权限」。
 */
async function requireManageRole(
  teamId: string,
  actorId: string,
  client: DbClient,
): Promise<void> {
  const membership = await getMembership(teamId, actorId, client);
  assertCan(membership?.role ?? null, "team:manage_projects");
}

/** 列出某团队的全部项目，按创建时间升序。 */
export async function listTeamProjects(
  teamId: string,
  client: DbClient = db,
): Promise<Project[]> {
  const rows = await client
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.createdAt));

  return rows.map(toProject);
}

/**
 * 批量列出多个团队的项目（侧栏一次取齐）。
 *
 * 传空数组直接返回空，避免生成无意义的 `IN ()`。
 */
export async function listTeamProjectsForTeams(
  teamIds: string[],
  client: DbClient = db,
): Promise<Project[]> {
  if (teamIds.length === 0) return [];

  const rows = await client
    .select()
    .from(projects)
    .where(inArray(projects.teamId, teamIds))
    .orderBy(asc(projects.createdAt));

  return rows.map(toProject);
}

/**
 * 按 slug 读取某团队的项目。
 *
 * 团队不匹配或 slug 不存在均返回 null，避免泄露项目是否存在。
 */
export async function getTeamProjectBySlug(
  teamId: string,
  slug: string,
  client: DbClient = db,
): Promise<Project | null> {
  const [row] = await client
    .select()
    .from(projects)
    .where(and(eq(projects.teamId, teamId), eq(projects.slug, slug)))
    .limit(1);

  return row ? toProject(row) : null;
}

/**
 * 创建团队项目（仅 owner/admin）。
 *
 * slug 由名称 ASCII 化生成，查重范围限定为 `team_id`；
 * 纯中文名回退为 `project`，重名追加 `-2`…（与个人项目口径一致）。
 */
export async function createTeamProject(
  input: { teamId: string; actorId: string; name: string; description?: string },
  client: DbClient = db,
): Promise<Project> {
  const name = validateName(input?.name);
  const description = validateDescription(input?.description);

  await requireManageRole(input.teamId, input.actorId, client);

  const slug = await generateUniqueSlug(name, async (candidate) => {
    const [existing] = await client
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.teamId, input.teamId), eq(projects.slug, candidate)))
      .limit(1);
    return Boolean(existing);
  });

  const [row] = await client
    .insert(projects)
    .values({ teamId: input.teamId, name, slug, description })
    .returning();

  return toProject(row!);
}

/** 读取团队项目行（内部使用）；团队不匹配 / 不存在返回 undefined。 */
async function findTeamProjectRow(
  teamId: string,
  projectId: string,
  client: DbClient,
): Promise<ProjectRow | undefined> {
  const [row] = await client
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);

  return row;
}

/**
 * 更新团队项目（仅 owner/admin）。
 *
 * 未传的字段保持不变，**slug 始终不随名称变化**；传入空描述会清空描述。
 */
export async function updateTeamProject(
  input: {
    teamId: string;
    projectId: string;
    actorId: string;
    name?: string;
    description?: string;
  },
  client: DbClient = db,
): Promise<Project> {
  await requireManageRole(input.teamId, input.actorId, client);

  const existing = await findTeamProjectRow(input.teamId, input.projectId, client);
  if (!existing) {
    throw new DomainError("项目不存在或无权访问");
  }

  const changes: Partial<Pick<ProjectRow, "name" | "description">> = {};

  if (input?.name !== undefined) {
    changes.name = validateName(input.name);
  }
  if (input?.description !== undefined) {
    changes.description = validateDescription(input.description);
  }

  if (Object.keys(changes).length === 0) {
    return toProject(existing);
  }

  const [row] = await client
    .update(projects)
    .set(changes)
    .where(and(eq(projects.id, input.projectId), eq(projects.teamId, input.teamId)))
    .returning();

  if (!row) {
    throw new DomainError("项目不存在或无权访问");
  }

  return toProject(row);
}

/**
 * 删除团队项目（仅 owner/admin）。
 *
 * 硬删除；任务 / 子任务 / 评论 / 相关通知由数据库外键级联兜底。
 */
export async function deleteTeamProject(
  input: { teamId: string; projectId: string; actorId: string },
  client: DbClient = db,
): Promise<void> {
  await requireManageRole(input.teamId, input.actorId, client);

  const [row] = await client
    .delete(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.teamId, input.teamId)))
    .returning({ id: projects.id });

  if (!row) {
    throw new DomainError("项目不存在或无权访问");
  }
}
