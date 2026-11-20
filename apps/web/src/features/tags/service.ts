import { isTagColor, isTagType, type Tag, type TagColor, type TagType, type TagWithUsage } from "@open-doing/types";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import type { DbClient } from "@/server/db/client";
import { db } from "@/server/db/client";
import { projectTags, tags, taskTags } from "@/server/db/schema";
import { assertCan, getMembership } from "@/features/teams/permissions";

import { TAG_DESCRIPTION_MAX_LENGTH, TAG_NAME_MAX_LENGTH, TAGS_PER_SPACE_LIMIT } from "./constants";

export { TAG_DESCRIPTION_MAX_LENGTH, TAG_NAME_MAX_LENGTH, TAGS_PER_SPACE_LIMIT } from "./constants";

type TagRow = typeof tags.$inferSelect;

/** 数据库行 -> 可跨边界传递的领域 Tag（时间统一为 ISO 字符串）。 */
function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    teamId: row.teamId,
    ownerId: row.ownerId,
    name: row.name,
    color: row.color,
    type: row.type,
    description: row.description ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 校验标签名：trim 非空 + 限长；非法抛 DomainError（tags ns）。 */
function validateTagName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";

  if (!name) {
    throw new DomainError("请输入标签名称", "name", { key: "nameRequired" });
  }
  if (name.length > TAG_NAME_MAX_LENGTH) {
    throw new DomainError(
      `标签名不能超过 ${TAG_NAME_MAX_LENGTH} 个字符`,
      "name",
      { key: "nameTooLong", params: { max: TAG_NAME_MAX_LENGTH } },
    );
  }

  return name;
}

/** 校验描述：trim，限长 100，空串归 null；非法抛 DomainError（tags ns）。 */
function validateTagDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DomainError("标签描述无效", "description", { key: "descriptionTooLong" });
  }
  const description = value.trim();
  if (!description) return null;
  if (description.length > TAG_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      `标签描述不能超过 ${TAG_DESCRIPTION_MAX_LENGTH} 个字符`,
      "description",
      { key: "descriptionTooLong", params: { max: TAG_DESCRIPTION_MAX_LENGTH } },
    );
  }
  return description;
}

/** 校验标签类型；非法抛 DomainError（tags ns）。 */
function validateTagType(value: unknown): TagType {
  if (!isTagType(value)) {
    throw new DomainError("标签类型无效", "type", { key: "typeInvalid" });
  }
  return value;
}

/** 校验颜色为预设色板 key；非法抛 DomainError（tags ns）。 */
function validateTagColor(value: unknown): TagColor {
  if (!isTagColor(value)) {
    throw new DomainError("标签颜色无效", "color", { key: "colorInvalid" });
  }
  return value;
}

/**
 * 归一化空间入参：`teamId` 与 `ownerId` 恰好传一个。
 *
 * 团队分支要求 `actorId` 且拥有 `team:manage_projects`（owner/admin）；
 * 个人分支要求 `actorId`（若传入）即 `ownerId`——action 层恒取会话用户，
 * 不一致属越界构造，用普通 Error 兜底。
 */
function resolveSpace(
  input: { teamId?: string; ownerId?: string; actorId?: string },
): { teamId: string | null; ownerId: string | null; actorId: string | undefined } {
  const { teamId, ownerId, actorId } = input;

  if ((teamId == null) === (ownerId == null)) {
    throw new Error("tag must belong to exactly one of team / owner");
  }
  if (teamId != null) {
    if (!actorId) {
      throw new Error("team tag management requires actorId");
    }
    return { teamId, ownerId: null, actorId };
  }

  const owner = ownerId!;
  if (actorId !== undefined && actorId !== owner) {
    throw new Error("personal tag actor must be the owner");
  }
  return { teamId: null, ownerId: owner, actorId };
}

/** 断言操作者可在该团队管理标签池（owner/admin，与项目管理同能力位）。 */
async function requireManageRole(
  teamId: string,
  actorId: string,
  client: DbClient,
): Promise<void> {
  const membership = await getMembership(teamId, actorId, client);
  // 非成员与 member 统一抛 TeamPermissionError（assertCan 对 null 角色同型）。
  assertCan(membership?.role ?? null, "team:manage_projects");
}

/** 读取空间内标签行；不存在（或空间不匹配）返回 undefined。 */
async function findTagRow(
  space: { teamId?: string | null; ownerId?: string | null },
  tagId: string,
  client: DbClient,
): Promise<TagRow | undefined> {
  const predicates = [
    eq(tags.id, tagId),
    space.teamId != null
      ? eq(tags.teamId, space.teamId)
      : eq(tags.ownerId, space.ownerId!),
  ];

  const [row] = await client
    .select()
    .from(tags)
    .where(and(...predicates))
    .limit(1);

  return row;
}

/** 列出某空间的全部标签（创建时间升序），附使用计数（打标任务数）。 */
export async function listTags(
  input: { teamId?: string; ownerId?: string },
  client: DbClient = db,
): Promise<TagWithUsage[]> {
  const { teamId, ownerId } = input;
  if ((teamId == null) === (ownerId == null)) {
    throw new Error("listTags requires exactly one of teamId / ownerId");
  }

  const rows = await client
    .select({
      id: tags.id,
      teamId: tags.teamId,
      ownerId: tags.ownerId,
      name: tags.name,
      color: tags.color,
      type: tags.type,
      description: tags.description,
      updatedAt: tags.updatedAt,
      createdAt: tags.createdAt,
      // 双口径：任务标签计 task_tags，项目标签计 project_tags（子查询，互不串）。
      usageCount: sql<number>`case when ${tags.type} = 'project'
        then (select count(*)::int from project_tags pt where pt.tag_id = ${tags.id})
        else (select count(*)::int from task_tags tt where tt.tag_id = ${tags.id}) end`,
    })
    .from(tags)
    .where(
      teamId != null ? eq(tags.teamId, teamId) : eq(tags.ownerId, ownerId!),
    )
    .orderBy(asc(tags.createdAt));

  return rows.map((row) => ({
    ...toTag(row),
    usageCount: row.usageCount,
  }));
}

/** 空间内标签计数（上限前置校验用；单空间 ≤ 50，无并发风险）。 */
async function countSpaceTags(
  space: { teamId: string | null; ownerId: string | null },
  client: DbClient,
): Promise<number> {
  const [row] = await client
    .select({ value: count() })
    .from(tags)
    .where(
      space.teamId != null
        ? and(eq(tags.teamId, space.teamId), isNotNull(tags.teamId))
        : and(eq(tags.ownerId, space.ownerId!), isNull(tags.teamId)),
    );
  return row?.value ?? 0;
}

/** 在空间内建标签（团队分支要求 owner/admin）。 */
export async function createTag(
  input: {
    teamId?: string;
    ownerId?: string;
    actorId?: string;
    name: string;
    color: TagColor;
    /** 标签类型；缺省 'task'（存量语义）。创建时定型，updateTag 不接受。 */
    type?: TagType;
    /** 可选描述；trim 限长 100，空归 null。 */
    description?: string | null;
  },
  client: DbClient = db,
): Promise<Tag> {
  const name = validateTagName(input?.name);
  const color = validateTagColor(input?.color);
  const type = input?.type === undefined ? "task" : validateTagType(input.type);
  const description = validateTagDescription(input?.description);
  const space = resolveSpace(input);

  if (space.teamId != null) {
    await requireManageRole(space.teamId, space.actorId!, client);
  }

  if ((await countSpaceTags(space, client)) >= TAGS_PER_SPACE_LIMIT) {
    throw new DomainError(
      `每个空间最多 ${TAGS_PER_SPACE_LIMIT} 个标签`,
      "name",
      { key: "tagLimitReached", params: { max: TAGS_PER_SPACE_LIMIT } },
    );
  }

  const [duplicate] = await client
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.name, name),
        space.teamId != null
          ? eq(tags.teamId, space.teamId)
          : eq(tags.ownerId, space.ownerId!),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new DomainError("该名称的标签已存在", "name", { key: "tagNameDuplicate" });
  }

  const [row] = await client
    .insert(tags)
    .values({
      teamId: space.teamId,
      ownerId: space.ownerId,
      name,
      color,
      type,
      description,
    })
    .returning();

  return toTag(row!);
}

/** 更新空间内标签（改名 / 换色；未传字段保持不变）。 */
export async function updateTag(
  input: {
    teamId?: string;
    ownerId?: string;
    actorId?: string;
    tagId: string;
    name?: string;
    color?: TagColor;
    /** 可选描述；`null` 清空。类型不可改（刻意不接受 type）。 */
    description?: string | null;
  },
  client: DbClient = db,
): Promise<Tag> {
  const space = resolveSpace(input);

  if (space.teamId != null) {
    await requireManageRole(space.teamId, space.actorId!, client);
  }

  const existing = await findTagRow(space, input.tagId, client);
  if (!existing) {
    throw new DomainError("标签不存在或无权访问", undefined, { key: "tagNotFound" });
  }

  // 注意：类型创建后不可改——updateTag 刻意不接受 type 入参，避免既有关联失效。
  const changes: Partial<Pick<TagRow, "name" | "color" | "description">> = {};

  if (input?.name !== undefined) {
    const name = validateTagName(input.name);
    if (name !== existing.name) {
      const [duplicate] = await client
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            eq(tags.name, name),
            space.teamId != null
              ? eq(tags.teamId, space.teamId)
              : eq(tags.ownerId, space.ownerId!),
          ),
        )
        .limit(1);
      if (duplicate && duplicate.id !== existing.id) {
        throw new DomainError("该名称的标签已存在", "name", { key: "tagNameDuplicate" });
      }
      changes.name = name;
    }
  }
  if (input?.color !== undefined) {
    changes.color = validateTagColor(input.color);
  }
  if (input?.description !== undefined) {
    changes.description = validateTagDescription(input.description);
  }

  if (Object.keys(changes).length === 0) {
    return toTag(existing);
  }

  const [row] = await client
    .update(tags)
    .set(changes)
    .where(eq(tags.id, existing.id))
    .returning();

  return toTag(row!);
}

/** 删除空间内标签（task_tags 由外键级联清理）。 */
export async function deleteTag(
  input: {
    teamId?: string;
    ownerId?: string;
    actorId?: string;
    tagId: string;
  },
  client: DbClient = db,
): Promise<void> {
  const space = resolveSpace(input);

  if (space.teamId != null) {
    await requireManageRole(space.teamId, space.actorId!, client);
  }

  const existing = await findTagRow(space, input.tagId, client);
  if (!existing) {
    throw new DomainError("标签不存在或无权访问", undefined, { key: "tagNotFound" });
  }

  await client.delete(tags).where(eq(tags.id, existing.id));
}

/** 按 id 批量取标签（打标校验用）；空数组直接返回空，避免无谓 `IN ()`。 */
export async function getTagsByIds(
  ids: string[],
  client: DbClient = db,
): Promise<Tag[]> {
  if (ids.length === 0) return [];

  const rows = await client.select().from(tags).where(inArray(tags.id, ids));
  return rows.map(toTag);
}

/**
 * 断言标签全部属于指定空间（团队 / 个人）；越界抛 DomainError（tags ns）。
 * 纯函数，供任务打标服务复用。
 */
export function assertTagsBelongToSpace(
  found: Tag[],
  space: { teamId?: string; ownerId?: string },
): void {
  for (const tag of found) {
    const inSpace =
      space.teamId != null
        ? tag.teamId === space.teamId
        : space.ownerId != null
          ? tag.ownerId === space.ownerId
          : false;
    if (!inSpace) {
      throw new DomainError("标签不属于当前空间", "tags", {
        key: "tagInvalidForSpace",
      });
    }
  }
}

/**
 * 断言标签全部为任务类型（任务打标专用）：混入 project 类型即类型错配。
 * 纯函数，供团队 / 个人任务打标服务复用。
 */
/**
 * 断言标签全部为项目类型（项目打标专用）：混入 task 类型即类型错配。
 * 纯函数，与 assertTagsAreTaskTags 对偶。
 */
export function assertTagsAreProjectTags(found: Tag[]): void {
  for (const tag of found) {
    if (tag.type !== "project") {
      throw new DomainError("标签类型与打标对象不匹配", "tags", {
        key: "tagTypeMismatch",
      });
    }
  }
}

export function assertTagsAreTaskTags(found: Tag[]): void {
  for (const tag of found) {
    if (tag.type !== "task") {
      throw new DomainError("标签类型与打标对象不匹配", "tags", {
        key: "tagTypeMismatch",
      });
    }
  }
}

/**
 * 批量取任务 → 标签映射（展示层数据组装）。
 *
 * 一次 `taskTags JOIN tags` 查询按 taskId 分组，防 N+1；空集合返回空 Map。
 * 已删除的标签因外键级联天然不出现，无需调用方过滤。
 */
export async function tagsByTaskId(
  taskIds: string[],
  client: DbClient = db,
): Promise<Map<string, Tag[]>> {
  const map = new Map<string, Tag[]>();
  if (taskIds.length === 0) return map;

  const rows = await client
    .select({ taskId: taskTags.taskId, tag: tags })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .where(inArray(taskTags.taskId, taskIds))
    .orderBy(asc(tags.createdAt));

  for (const row of rows) {
    const list = map.get(row.taskId) ?? [];
    list.push(toTag(row.tag));
    map.set(row.taskId, list);
  }
  return map;
}

/**
 * 批量取项目 → 标签映射（项目卡片展示用，语义同 tagsByTaskId）。
 * 一次 JOIN 按 projectId 分组防 N+1；空集合返回空 Map。
 */
export async function tagsByProjectId(
  projectIds: string[],
  client: DbClient = db,
): Promise<Map<string, Tag[]>> {
  const map = new Map<string, Tag[]>();
  if (projectIds.length === 0) return map;

  const rows = await client
    .select({ projectId: projectTags.projectId, tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds))
    .orderBy(asc(tags.createdAt));

  for (const row of rows) {
    const list = map.get(row.projectId) ?? [];
    list.push(toTag(row.tag));
    map.set(row.projectId, list);
  }
  return map;
}
