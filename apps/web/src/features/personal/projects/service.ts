import type { Project, ProjectMilestone, TaskPriority } from "@open-doing/types";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import {
  buildProjectStats,
  listProjectTaskStatRows,
  milestoneCountsByProjectId,
  normalizeMilestoneInputs,
  normalizePriority,
  type ProjectListItem,
  type ProjectMilestoneInput,
  type ProjectTaskStatRow,
} from "@/features/projects/service";
import { generateUniqueSlug } from "@/lib/slug";
import { db, type DbClient } from "@/server/db/client";
import { assertTagsAreProjectTags, assertTagsBelongToSpace, getTagsByIds, tagsByProjectId } from "@/features/tags/service";
import { projectMilestones, projectTags, projects, tasks } from "@/server/db/schema";

/** 项目名称长度上限（与表单校验一致）。 */
export const PROJECT_NAME_MAX_LENGTH = 50;

/** 项目描述长度上限（与表单校验一致）。 */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

/** 项目一句话简述长度上限（与表单校验一致）。 */
export const PROJECT_SUMMARY_MAX_LENGTH = 100;

type ProjectRow = typeof projects.$inferSelect;

/** 数据库行 -> 可跨边界传递的领域 Project（时间统一为 ISO 字符串）。 */
function toProject(row: ProjectRow, tags?: Project["tags"]): Project {
  return {
    id: row.id,
    teamId: row.teamId,
    ownerId: row.ownerId,
    name: row.name,
    slug: row.slug,
    summary: row.summary ?? undefined,
    description: row.description ?? undefined,
    startDate: row.startDate ?? undefined,
    endDate: row.endDate ?? undefined,
    priority: row.priority,
    tags,
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
    throw new DomainError("请输入项目名称", "name", { key: "nameRequired" });
  }
  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    throw new DomainError(
      `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`,
      "name",
      { key: "nameTooLong", params: { max: PROJECT_NAME_MAX_LENGTH } },
    );
  }

  return name;
}

/** 一句话简述清空统一存 undefined；≤100 字符。 */
function validateSummary(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const summary = value.trim();
  if (!summary) return undefined;
  if (summary.length > PROJECT_SUMMARY_MAX_LENGTH) {
    throw new DomainError(
      `简述不能超过 ${PROJECT_SUMMARY_MAX_LENGTH} 个字符`,
      "summary",
      { key: "summaryTooLong", params: { max: PROJECT_SUMMARY_MAX_LENGTH } },
    );
  }
  return summary;
}

function validateDescription(value: unknown): string | undefined {
  const description = normalizeDescription(value);

  if (description && description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      `描述不能超过 ${PROJECT_DESCRIPTION_MAX_LENGTH} 个字符`,
      "description",
      { key: "descriptionTooLong", params: { max: PROJECT_DESCRIPTION_MAX_LENGTH } },
    );
  }

  return description;
}

/**
 * 列出某用户的全部个人项目，按最近活动时间降序。
 *
 * 活动时间 = 项目内任务的最大 `updated_at`；没有任何任务时回落到项目创建时间，
 * 因此空项目不会凭空置顶。活动时间相同再按创建时间降序。
 *
 * 只按 `owner_id` 过滤，不返回任何团队项目。
 */
export async function listPersonalProjects(
  userId: string,
  client: DbClient = db,
): Promise<Project[]> {
  const lastActivityAt = sql<Date>`COALESCE(
    (SELECT max(${tasks.updatedAt}) FROM ${tasks} WHERE ${tasks.projectId} = ${projects.id}),
    ${projects.createdAt}
  )`;

  const rows = await client
    .select()
    .from(projects)
    .where(eq(projects.ownerId, userId))
    .orderBy(desc(lastActivityAt), desc(projects.createdAt));

  return rows.map((row) => toProject(row));
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

  if (!row) return null;
  const tagsMap = await tagsByProjectId([row.id], client);
  return toProject(row, tagsMap.get(row.id) ?? []);
}

/**
 * 创建个人项目。
 *
 * - 名称必填 1–50 字，描述不超过 500 字；
 * - slug 由名称 ASCII 化生成，查重范围限定为 `owner_id = userId`；
 * - 个人项目不设置 `team_id`，由服务层断言与数据库 CHECK 约束共同保证归属唯一。
 */
/** 项目打标：全量覆写 project_tags（owner-only 由调用方保证）；不动 projects 行。 */
async function applyOwnedProjectTags(
  projectId: string,
  tagIds: string[],
  ownerId: string,
  client: DbClient,
): Promise<void> {
  const pool = await getTagsByIds(tagIds, client);
  if (pool.length !== tagIds.length) {
    throw new DomainError("标签不存在或无权访问", "tags", { key: "tagInvalidForSpace" });
  }
  assertTagsBelongToSpace(pool, { ownerId });
  assertTagsAreProjectTags(pool);

  await client.transaction(async (tx) => {
    await tx.delete(projectTags).where(
      tagIds.length === 0
        ? eq(projectTags.projectId, projectId)
        : and(eq(projectTags.projectId, projectId), notInArray(projectTags.tagId, tagIds)),
    );
    if (tagIds.length > 0) {
      await tx
        .insert(projectTags)
        .values(tagIds.map((tagId) => ({ projectId, tagId })))
        .onConflictDoNothing();
    }
  });
}

/** 起止日期对校验：都非空时 end >= start；非法抛 DomainError（projects ns）。 */
function assertProjectDateRange(startDate: string | null, endDate: string | null): void {
  if (startDate && endDate && endDate < startDate) {
    throw new DomainError("结束日期不能早于开始日期", "endDate", { key: "projectDateRange" });
  }
}

export async function createPersonalProject(
  userId: string,
  input: {
    name: string;
    /** 一句话简述（≤100 字符）。 */
    summary?: string;
    description?: string;
    /** 起止日期（`YYYY-MM-DD`，可空）；end >= start 由服务层校验。 */
    startDate?: string | null;
    endDate?: string | null;
    /** 项目优先级；缺省 medium。 */
    priority?: TaskPriority;
    /** 初始项目标签（全量覆写）。 */
    tagIds?: string[];
    /** 初始里程碑（创建弹窗随表单一次性提交）。 */
    milestones?: ProjectMilestoneInput[];
  },
  client: DbClient = db,
): Promise<Project> {
  const name = validateName(input?.name);
  const summary = validateSummary(input?.summary);
  const description = validateDescription(input?.description);
  const startDate = input?.startDate ?? null;
  const endDate = input?.endDate ?? null;
  assertProjectDateRange(startDate, endDate);
  const priority = normalizePriority(input?.priority);
  const milestones = normalizeMilestoneInputs(input?.milestones);

  // spec decision 7：项目必须且只能归属团队或个人之一。UI / action 层不会
  // 构造越界入参，故该不变量用普通 Error 兜底，不分配 i18n key。
  const teamId: string | null = null;
  const ownerId: string | null = userId;
  if ((teamId == null) === (ownerId == null)) {
    throw new Error("project must belong to exactly one of team / owner");
  }

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

  // 项目行、初始里程碑、初始标签收进同一事务：任一失败整体回滚。
  const row = await client.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(projects)
      .values({
        ownerId: userId,
        name,
        slug,
        summary: summary ?? null,
        description: description ?? null,
        startDate,
        endDate,
        priority,
      })
      .returning();

    if (milestones.length > 0) {
      await tx.insert(projectMilestones).values(
        milestones.map((milestone) => ({
          projectId: inserted!.id,
          name: milestone.name,
          description: milestone.description,
          dueDate: milestone.dueDate,
        })),
      );
    }

    if (input.tagIds?.length) {
      await applyOwnedProjectTags(inserted!.id, Array.from(new Set(input.tagIds)), userId, tx);
    }

    return inserted!;
  });

  const tagsMap = await tagsByProjectId([row.id], client);
  return toProject(row, tagsMap.get(row.id) ?? []);
}

/** 里程碑数据库行 -> 领域 ProjectMilestone（时间统一为 ISO 字符串）。 */
function toMilestone(row: typeof projectMilestones.$inferSelect): ProjectMilestone {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? undefined,
    dueDate: row.dueDate ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 归属断言 + 返回本人项目行；失败抛 projectNotFound。 */
async function requireOwnedProjectRow(
  userId: string,
  projectId: string,
  client: DbClient,
): Promise<NonNullable<Awaited<ReturnType<typeof findOwnedProjectRow>>>> {
  const row = await findOwnedProjectRow(userId, projectId, client);
  if (!row) {
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }
  return row;
}

/** 新增个人项目里程碑（owner-only；校验复用共享 normalizeMilestoneInputs）。 */
export async function addPersonalProjectMilestone(
  userId: string,
  projectId: string,
  input: { name: string; description?: string; dueDate?: string | null },
  client: DbClient = db,
): Promise<ProjectMilestone> {
  const project = await requireOwnedProjectRow(userId, projectId, client);
  const [milestone] = normalizeMilestoneInputs([input]);

  const [row] = await client
    .insert(projectMilestones)
    .values({
      projectId: project.id,
      name: milestone!.name,
      description: milestone!.description,
      dueDate: milestone!.dueDate,
    })
    .returning();

  return toMilestone(row!);
}

/** 删除个人项目里程碑（owner-only）；milestoneId 不属于该项目 → milestoneNotFound。 */
export async function deletePersonalProjectMilestone(
  userId: string,
  projectId: string,
  milestoneId: string,
  client: DbClient = db,
): Promise<void> {
  await requireOwnedProjectRow(userId, projectId, client);

  const [row] = await client
    .delete(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.projectId, projectId),
      ),
    )
    .returning({ id: projectMilestones.id });

  if (!row) {
    throw new DomainError("里程碑不存在或无权访问", "milestones", { key: "milestoneNotFound" });
  }
}

/** 列出个人项目的里程碑：dueDate 升序（PG ASC 默认 NULLS LAST），同日按创建序。 */
export async function listPersonalProjectMilestones(
  userId: string,
  projectId: string,
  client: DbClient = db,
): Promise<ProjectMilestone[]> {
  await requireOwnedProjectRow(userId, projectId, client);

  const rows = await client
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.dueDate), asc(projectMilestones.createdAt));

  return rows.map(toMilestone);
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
  input: {
    name?: string;
    /** 一句话简述；`null`/空串清空，未传保持不变。 */
    summary?: string;
    description?: string;
    /** 起止日期；`null` 清空，未传保持不变。 */
    startDate?: string | null;
    endDate?: string | null;
    /** 项目优先级；未传保持不变。 */
    priority?: TaskPriority;
    /** 项目标签全量覆写；仅写 project_tags。 */
    tagIds?: string[];
  },
  client: DbClient = db,
): Promise<Project> {
  const existing = await findOwnedProjectRow(userId, projectId, client);
  if (!existing) {
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }

  const changes: Partial<
    Pick<ProjectRow, "name" | "summary" | "description" | "startDate" | "endDate" | "priority">
  > = {};

  if (input?.name !== undefined) {
    changes.name = validateName(input.name);
  }
  if (input?.summary !== undefined) {
    changes.summary = validateSummary(input.summary) ?? null;
  }
  if (input?.description !== undefined) {
    changes.description = validateDescription(input.description) ?? null;
  }
  if (input?.startDate !== undefined) {
    changes.startDate = input.startDate;
  }
  if (input?.endDate !== undefined) {
    changes.endDate = input.endDate;
  }
  // 显式字段赋值（禁止整对象 spread 装载走私）：未传的 priority 不进 changes。
  if (input?.priority !== undefined) {
    changes.priority = normalizePriority(input.priority);
  }
  // 与新值组合出最终日期对再校验（允许先改一端；显式 null 是"清空"，
  // 必须按新值参与校验，否则清空一端会被旧值误判为区间倒挂）。
  assertProjectDateRange(
    changes.startDate !== undefined ? changes.startDate : (existing.startDate ?? null),
    changes.endDate !== undefined ? changes.endDate : (existing.endDate ?? null),
  );

  if (Object.keys(changes).length === 0) {
    // 仅打标（无其他字段变更）：只写 project_tags，不触碰 projects 行。
    if (input.tagIds !== undefined) {
      await applyOwnedProjectTags(projectId, Array.from(new Set(input.tagIds)), userId, client);
    }
    const tagsMap = await tagsByProjectId([existing.id], client);
    return toProject(existing, tagsMap.get(existing.id) ?? []);
  }

  const [row] = await client
    .update(projects)
    .set(changes)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)))
    .returning();

  if (!row) {
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }

  if (input.tagIds !== undefined) {
    await applyOwnedProjectTags(projectId, Array.from(new Set(input.tagIds)), userId, client);
  }
  const tagsMap = await tagsByProjectId([row.id], client);
  return toProject(row, tagsMap.get(row.id) ?? []);
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
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }
}

/**
 * 个人项目列表(创建时间升序),附每项目聚合统计。
 *
 * 只按 `owner_id` + `spaceType='personal'` 过滤,他人项目不可见;聚合与
 * 健康口径复用 `features/projects` 的共享实现(`buildProjectStats` /
 * `listProjectTaskStatRows`)。注意与 `listPersonalProjects` 的"最近活动
 * 降序"是两套排序:后者是日历/看板/详情页的既有行为,本函数仅服务列表页。
 * `today` 由调用方注入(Asia/Shanghai 的 `YYYY-MM-DD`)。
 */
export async function getPersonalProjectListWithStats(
  userId: string,
  today: string,
  client: DbClient = db,
): Promise<ProjectListItem[]> {
  const projectRows = await client
    .select()
    .from(projects)
    .where(and(eq(projects.ownerId, userId), isNull(projects.teamId)))
    .orderBy(asc(projects.createdAt));

  if (projectRows.length === 0) return [];

  const statRows = await listProjectTaskStatRows(
    projectRows.map((row) => row.id),
    client,
  );
  const rowsByProject = new Map<string, ProjectTaskStatRow[]>(
    projectRows.map((row) => [row.id, []]),
  );
  for (const row of statRows) {
    rowsByProject.get(row.projectId)?.push(row);
  }

  const projectTagsMap = await tagsByProjectId(
    projectRows.map((row) => row.id),
    client,
  );
  const milestoneCounts = await milestoneCountsByProjectId(
    projectRows.map((row) => row.id),
    client,
  );
  return projectRows.map((row) => ({
    project: toProject(row, projectTagsMap.get(row.id) ?? []),
    stats: buildProjectStats(rowsByProject.get(row.id) ?? [], today),
    milestoneCount: milestoneCounts.get(row.id) ?? 0,
  }));
}
