import type { Project } from "@open-doing/types";
import { and, asc, eq } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import { generateUniqueSlug } from "@/lib/slug";
import { db, type DbClient } from "@/server/db/client";
import { projects } from "@/server/db/schema";

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

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 描述清空统一存 null，读取时映射为 undefined。 */
function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateName(value: unknown): string {
  const name = normalizeName(value);

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

function validateDescription(value: unknown): string | undefined {
  const description = normalizeDescription(value);

  if (description && description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      `描述不能超过 ${PROJECT_DESCRIPTION_MAX_LENGTH} 个字符`,
      "description",
    );
  }

  return description;
}

/**
 * 列出某用户的全部个人项目，按创建时间升序。
 *
 * 只按 `owner_id` 过滤，不返回任何团队项目。
 */
export async function listPersonalProjects(
  userId: string,
  client: DbClient = db,
): Promise<Project[]> {
  const rows = await client
    .select()
    .from(projects)
    .where(eq(projects.ownerId, userId))
    .orderBy(asc(projects.createdAt));

  return rows.map(toProject);
}

/**
 * 按 slug 读取当前用户的个人项目。
 *
 * 不存在或属于他人均返回 null，避免泄露项目是否存在。
 */
export async function getPersonalProjectBySlug(
  userId: string,
  slug: string,
  client: DbClient = db,
): Promise<Project | null> {
  const [row] = await client
    .select()
    .from(projects)
    .where(and(eq(projects.ownerId, userId), eq(projects.slug, slug)))
    .limit(1);

  return row ? toProject(row) : null;
}

/**
 * 创建个人项目。
 *
 * - 名称必填 1–50 字，描述不超过 500 字；
 * - slug 由名称 ASCII 化生成，查重范围限定为 `owner_id = userId`；
 * - 个人项目不设置 `team_id`，由数据库 CHECK 约束保证归属唯一。
 */
export async function createPersonalProject(
  userId: string,
  input: { name: string; description?: string },
  client: DbClient = db,
): Promise<Project> {
  const name = validateName(input?.name);
  const description = validateDescription(input?.description);

  const slug = await generateUniqueSlug(name, async (candidate) => {
    const [existing] = await client
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.ownerId, userId), eq(projects.slug, candidate)),
      )
      .limit(1);
    return Boolean(existing);
  });

  const [row] = await client
    .insert(projects)
    .values({ ownerId: userId, name, slug, description: description ?? null })
    .returning();

  return toProject(row!);
}

/** 读取本人项目行（内部使用）；不存在 / 非本人返回 undefined。 */
async function findOwnedProjectRow(
  userId: string,
  projectId: string,
  client: DbClient,
): Promise<ProjectRow | undefined> {
  const [row] = await client
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .limit(1);

  return row;
}

/**
 * 更新个人项目。
 *
 * 先断言归属；未传的字段保持不变，**slug 始终不随名称变化**。
 * 传入空描述会清空描述。
 */
export async function updatePersonalProject(
  userId: string,
  projectId: string,
  input: { name?: string; description?: string },
  client: DbClient = db,
): Promise<Project> {
  const existing = await findOwnedProjectRow(userId, projectId, client);
  if (!existing) {
    throw new DomainError("项目不存在或无权访问");
  }

  const changes: Partial<Pick<ProjectRow, "name" | "description">> = {};

  if (input?.name !== undefined) {
    changes.name = validateName(input.name);
  }
  if (input?.description !== undefined) {
    changes.description = validateDescription(input.description) ?? null;
  }

  if (Object.keys(changes).length === 0) {
    return toProject(existing);
  }

  const [row] = await client
    .update(projects)
    .set(changes)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .returning();

  if (!row) {
    throw new DomainError("项目不存在或无权访问");
  }

  return toProject(row);
}

/**
 * 删除个人项目。
 *
 * 归属断言失败抛 DomainError；内容级联（任务 / 子任务 / 评论）
 * 由数据库外键 `onDelete: cascade` 兜底。
 */
export async function deletePersonalProject(
  userId: string,
  projectId: string,
  client: DbClient = db,
): Promise<void> {
  const [row] = await client
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .returning({ id: projects.id });

  if (!row) {
    throw new DomainError("项目不存在或无权访问");
  }
}
