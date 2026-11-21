import type {
  Project,
  ProjectMemberRef,
  ProjectMilestone,
  ProjectStats,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "@open-doing/types";
import {
  averageProjectProgress,
  getTaskProgress,
  isDueSoon,
  isOverdue,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
} from "@open-doing/types";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { DomainError } from "@/lib/domain-error";
import { generateUniqueSlug } from "@/lib/slug";
import type { DbClient } from "@/server/db/client";
import { db } from "@/server/db/client";
import { projectMembers, projectMilestones, projectTags, projects, subtasks, tasks, users } from "@/server/db/schema";
import { assertCan, getMembership } from "@/features/teams/permissions";
import { assertTagsAreProjectTags, assertTagsBelongToSpace, getTagsByIds, tagsByProjectId } from "@/features/tags/service";

// 限长常量唯一来源：features/projects/constants.ts（客户端安全）。
// 服务端校验器仍在本模块（server-only），常量经重导出兼容既有引用。
import {
  MILESTONE_DESCRIPTION_MAX_LENGTH,
  MILESTONE_NAME_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SUMMARY_MAX_LENGTH,
} from "./constants";

export {
  MILESTONE_DESCRIPTION_MAX_LENGTH,
  MILESTONE_NAME_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SUMMARY_MAX_LENGTH,
} from "./constants";

type ProjectRow = typeof projects.$inferSelect;
type MilestoneRow = typeof projectMilestones.$inferSelect;

/** 数据库行 -> 可跨边界传递的领域 Project（时间统一为 ISO 字符串）。 */
function toProject(row: ProjectRow, tags?: Project["tags"]): Project {
  return {
    id: row.id,
    teamId: row.teamId,
    ownerId: row.ownerId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    leadId: row.leadId,
    summary: row.summary ?? undefined,
    description: row.description ?? undefined,
    startDate: row.startDate ?? undefined,
    endDate: row.endDate ?? undefined,
    priority: row.priority,
    tags,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 里程碑数据库行 -> 领域 ProjectMilestone（时间统一为 ISO 字符串）。 */
function toMilestone(row: MilestoneRow): ProjectMilestone {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? undefined,
    dueDate: row.dueDate ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 状态归一：undefined 回落 "backlog"；非法值抛 DomainError
 * （field "status"，key "statusInvalid"）。团队/个人服务共用。
 */
export function normalizeProjectStatus(value?: ProjectStatus): ProjectStatus {
  if (value === undefined) return "backlog";
  if (!PROJECT_STATUSES.includes(value)) {
    throw new DomainError("状态取值非法", "status", { key: "statusInvalid" });
  }
  return value;
}

/** 批量断言 user 均为团队成员；首个非成员抛 DomainError(field "members")。 */
async function assertTeamMembers(
  teamId: string,
  userIds: readonly string[],
  client: DbClient,
): Promise<void> {
  for (const userId of userIds) {
    const membership = await getMembership(teamId, userId, client);
    if (!membership) {
      throw new DomainError("成员必须是团队成员", "members", { key: "memberNotInTeam" });
    }
  }
}

/** 断言单个负责人为团队成员；非成员抛 DomainError(field "leadId")。 */
async function assertTeamLead(teamId: string, leadId: string, client: DbClient): Promise<void> {
  const membership = await getMembership(teamId, leadId, client);
  if (!membership) {
    throw new DomainError("负责人必须是团队成员", "leadId", { key: "leadNotMember" });
  }
}

/** 项目成员全量覆写（事务；空数组清空）。 */
async function applyProjectMembers(
  projectId: string,
  memberIds: string[],
  client: DbClient,
): Promise<void> {
  await client.transaction(async (tx) => {
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    if (memberIds.length > 0) {
      await tx
        .insert(projectMembers)
        .values(memberIds.map((userId) => ({ projectId, userId })))
        .onConflictDoNothing();
    }
  });
}

/**
 * 优先级归一：undefined 回落 "medium"；非法值抛 DomainError
 * （field "priority"，key "priorityInvalid"）。团队/个人服务共用。
 */
export function normalizePriority(value?: TaskPriority): TaskPriority {
  if (value === undefined) return "medium";
  if (!TASK_PRIORITIES.includes(value)) {
    throw new DomainError("优先级取值非法", "priority", { key: "priorityInvalid" });
  }
  return value;
}

/** 里程碑表单入参（创建时随表单一次性提交）。 */
export interface ProjectMilestoneInput {
  name: string;
  description?: string;
  dueDate?: string | null;
}

/**
 * 里程碑入参校验（共享校验器，个人侧复用）：名称必填 ≤50 字，描述 ≤200 字，
 * dueDate 空串归 null；非法抛 DomainError（field "milestones"，projects ns）。
 */
export function normalizeMilestoneInputs(
  inputs?: ProjectMilestoneInput[],
): { name: string; description: string | null; dueDate: string | null }[] {
  if (!inputs?.length) return [];

  return inputs.map((input) => {
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (!name) {
      throw new DomainError("请输入里程碑名称", "milestones", { key: "milestoneNameRequired" });
    }
    if (name.length > MILESTONE_NAME_MAX_LENGTH) {
      throw new DomainError(
        `里程碑名称不能超过 ${MILESTONE_NAME_MAX_LENGTH} 个字符`,
        "milestones",
        { key: "milestoneNameTooLong", params: { max: MILESTONE_NAME_MAX_LENGTH } },
      );
    }

    const description = typeof input?.description === "string" ? input.description.trim() : "";
    if (description.length > MILESTONE_DESCRIPTION_MAX_LENGTH) {
      throw new DomainError(
        `里程碑描述不能超过 ${MILESTONE_DESCRIPTION_MAX_LENGTH} 个字符`,
        "milestones",
        { key: "milestoneDescriptionTooLong", params: { max: MILESTONE_DESCRIPTION_MAX_LENGTH } },
      );
    }

    return {
      name,
      description: description || null,
      dueDate: input?.dueDate ? input.dueDate : null,
    };
  });
}

function validateName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";

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

/** 描述清空统一存 null，读取时映射为 undefined。 */
function validateDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const description = value.trim();
  if (!description) return null;
  if (description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      `描述不能超过 ${PROJECT_DESCRIPTION_MAX_LENGTH} 个字符`,
      "description",
      { key: "descriptionTooLong", params: { max: PROJECT_DESCRIPTION_MAX_LENGTH } },
    );
  }

  return description;
}

/** 一句话简述清空统一存 null；≤100 字符（Linear 式标题下一行）。 */
function validateSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const summary = value.trim();
  if (!summary) return null;
  if (summary.length > PROJECT_SUMMARY_MAX_LENGTH) {
    throw new DomainError(
      `简述不能超过 ${PROJECT_SUMMARY_MAX_LENGTH} 个字符`,
      "summary",
      { key: "summaryTooLong", params: { max: PROJECT_SUMMARY_MAX_LENGTH } },
    );
  }

  return summary;
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

/** 起止日期对校验：都非空时 end >= start；非法抛 DomainError（projects ns）。 */
function assertProjectDateRange(
  startDate: string | null,
  endDate: string | null,
): void {
  if (startDate && endDate && endDate < startDate) {
    throw new DomainError("结束日期不能早于开始日期", "endDate", {
      key: "projectDateRange",
    });
  }
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

  return rows.map((row) => toProject(row));
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

  return rows.map((row) => toProject(row));
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
  input: {
    teamId: string;
    actorId: string;
    name: string;
    /** 一句话简述（≤100 字符）。 */
    summary?: string;
    description?: string;
    /** 起止日期（`YYYY-MM-DD`，可空）；end >= start 由服务层校验。 */
    startDate?: string | null;
    endDate?: string | null;
    /** 项目优先级；缺省 medium。 */
    priority?: TaskPriority;
    /** 项目状态；缺省 backlog。 */
    status?: ProjectStatus;
    /** 负责人（团队成员）；缺省 null。设负责人自动并入成员。 */
    leadId?: string | null;
    /** 初始成员（团队成员，全量覆写语义）。 */
    memberIds?: string[];
    /** 初始项目标签（全量覆写语义；仅写 project_tags）。 */
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
  const status = normalizeProjectStatus(input?.status);
  const milestones = normalizeMilestoneInputs(input?.milestones);

  const leadId = input?.leadId ?? null;
  if (leadId) await assertTeamLead(input.teamId, leadId, client);
  // lead 自动并入成员
  const memberIds = leadId
    ? Array.from(new Set([leadId, ...(input?.memberIds ?? [])]))
    : (input?.memberIds ?? []);
  await assertTeamMembers(input.teamId, memberIds, client);

  // spec decision 7：项目必须且只能归属团队或个人之一。UI / action 层不会
  // 构造越界入参，故该不变量用普通 Error 兜底，不分配 i18n key。
  const teamId: string | null = input.teamId;
  const ownerId: string | null = null;
  if ((teamId == null) === (ownerId == null)) {
    throw new Error("project must belong to exactly one of team / owner");
  }

  await requireManageRole(input.teamId, input.actorId, client);

  const slug = await generateUniqueSlug(name, async (candidate) => {
    const [existing] = await client
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.teamId, input.teamId), eq(projects.slug, candidate)))
      .limit(1);
    return Boolean(existing);
  });

  // 项目行、初始里程碑、初始标签收进同一事务：任一失败整体回滚。
  const row = await client.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(projects)
      .values({ teamId: input.teamId, name, slug, summary, description, startDate, endDate, priority, status, leadId })
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
      await applyProjectTags(
        { teamId: input.teamId, projectId: inserted!.id, actorId: input.actorId, tagIds: Array.from(new Set(input.tagIds)) },
        tx,
      );
    }

    if (memberIds.length > 0) {
      await tx
        .insert(projectMembers)
        .values(memberIds.map((userId) => ({ projectId: inserted!.id, userId })))
        .onConflictDoNothing();
    }

    return inserted!;
  });

  const tagsMap = await tagsByProjectId([row.id], client);
  return toProject(row, tagsMap.get(row.id) ?? []);
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
    /** 一句话简述；`null`/空串清空，未传保持不变。 */
    summary?: string;
    description?: string;
    /** 起止日期；`null` 清空，未传保持不变。 */
    startDate?: string | null;
    endDate?: string | null;
    /** 项目优先级；未传保持不变。 */
    priority?: TaskPriority;
    /** 项目状态；未传保持不变。 */
    status?: ProjectStatus;
    /** 负责人；`null` 显式清空，未传保持不变。 */
    leadId?: string | null;
    /** 项目成员全量覆写；未传保持不变。 */
    memberIds?: string[];
    /** 项目标签全量覆写；仅写 project_tags，不动 projects 行。 */
    tagIds?: string[];
  },
  client: DbClient = db,
): Promise<Project> {
  await requireManageRole(input.teamId, input.actorId, client);

  const existing = await findTeamProjectRow(input.teamId, input.projectId, client);
  if (!existing) {
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }

  const changes: Partial<
    Pick<
      ProjectRow,
      | "name"
      | "summary"
      | "description"
      | "startDate"
      | "endDate"
      | "priority"
      | "status"
      | "leadId"
    >
  > = {};

  if (input?.name !== undefined) {
    changes.name = validateName(input.name);
  }
  if (input?.summary !== undefined) {
    changes.summary = validateSummary(input.summary);
  }
  if (input?.description !== undefined) {
    changes.description = validateDescription(input.description);
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
  if (input?.status !== undefined) {
    changes.status = normalizeProjectStatus(input.status);
  }
  // 与新值组合出最终日期对再校验（允许先改一端；显式 null 是"清空"，
  // 必须按新值参与校验，否则清空一端会被旧值误判为区间倒挂）。
  assertProjectDateRange(
    changes.startDate !== undefined ? changes.startDate : (existing.startDate ?? null),
    changes.endDate !== undefined ? changes.endDate : (existing.endDate ?? null),
  );

  // lead / members 校验与计算（Review Focus #1/#2）
  if (input?.leadId !== undefined && input.leadId !== null) {
    await assertTeamLead(input.teamId, input.leadId, client);
  }
  if (input?.memberIds !== undefined) {
    await assertTeamMembers(input.teamId, input.memberIds, client);
  }
  // members 全量覆写（lead 自动并入）；随后覆写不含现 lead → leadId 置 null
  if (input?.memberIds !== undefined) {
    const finalMembers = input.leadId
      ? Array.from(new Set([input.leadId, ...input.memberIds]))
      : Array.from(new Set(input.memberIds));
    await applyProjectMembers(input.projectId, finalMembers, client);
    const effectiveLead = input.leadId !== undefined ? input.leadId : existing.leadId;
    if (effectiveLead && !finalMembers.includes(effectiveLead)) {
      changes.leadId = null;
    }
  } else if (input?.leadId !== undefined) {
    if (input.leadId === null) {
      changes.leadId = null;
    } else {
      changes.leadId = input.leadId;
      const current = await client
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, input.projectId));
      await applyProjectMembers(input.projectId, Array.from(new Set([input.leadId, ...current.map((r) => r.userId)])), client);
    }
  }

  if (Object.keys(changes).length === 0) {
    // 仅打标（无其他字段变更）：只写 project_tags，不触碰 projects 行。
    if (input.tagIds !== undefined) {
      await applyProjectTags(
        { teamId: input.teamId, projectId: input.projectId, actorId: input.actorId, tagIds: Array.from(new Set(input.tagIds)) },
        client,
      );
    }
    const tagsMap = await tagsByProjectId([existing.id], client);
    return toProject(existing, tagsMap.get(existing.id) ?? []);
  }

  const [row] = await client
    .update(projects)
    .set(changes)
    .where(and(eq(projects.id, input.projectId), eq(projects.teamId, input.teamId)))
    .returning();

  if (!row) {
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }

  if (input.tagIds !== undefined) {
    await applyProjectTags(
      { teamId: input.teamId, projectId: input.projectId, actorId: input.actorId, tagIds: Array.from(new Set(input.tagIds)) },
      client,
    );
  }
  const tagsMap = await tagsByProjectId([row.id], client);
  return toProject(row, tagsMap.get(row.id) ?? []);
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
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }
}

/**
 * 更新团队项目状态（仅 owner/admin）：状态专用写路径（就地改），
 * 不经过完整 update，避免字段走私；只写 status 列。
 */
export async function updateTeamProjectStatus(
  input: { teamId: string; projectId: string; actorId: string; status: ProjectStatus },
  client: DbClient = db,
): Promise<Project> {
  await requireManageRole(input.teamId, input.actorId, client);
  const project = await requireTeamProjectRow(input.teamId, input.projectId, client);
  const status = normalizeProjectStatus(input.status);

  const [row] = await client
    .update(projects)
    .set({ status })
    .where(and(eq(projects.id, project.id), eq(projects.teamId, input.teamId)))
    .returning();

  return toProject(row!);
}

/** 项目列表项:项目 + 聚合统计 + 里程碑计数(空间级「项目」列表页)。 */
export interface ProjectListItem {
  project: Project;
  stats: ProjectStats;
  milestoneCount: number;
}

/** 读取团队项目行（供里程碑函数复用）；团队不匹配 / 不存在抛 projectNotFound。 */
async function requireTeamProjectRow(
  teamId: string,
  projectId: string,
  client: DbClient,
): Promise<ProjectRow> {
  const row = await findTeamProjectRow(teamId, projectId, client);
  if (!row) {
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }
  return row;
}

/**
 * 新增团队项目里程碑（owner/admin）。名称/描述校验复用共享校验器
 * （field "milestones"）；dueDate 可空（表单侧必填，服务层容错）。
 */
export async function addTeamProjectMilestone(
  input: {
    teamId: string;
    projectId: string;
    actorId: string;
    name: string;
    description?: string;
    dueDate?: string | null;
  },
  client: DbClient = db,
): Promise<ProjectMilestone> {
  await requireManageRole(input.teamId, input.actorId, client);
  const project = await requireTeamProjectRow(input.teamId, input.projectId, client);
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

/** 删除团队项目里程碑（owner/admin）；milestoneId 不属于该项目 → milestoneNotFound。 */
export async function deleteTeamProjectMilestone(
  input: { teamId: string; projectId: string; milestoneId: string; actorId: string },
  client: DbClient = db,
): Promise<void> {
  await requireManageRole(input.teamId, input.actorId, client);
  await requireTeamProjectRow(input.teamId, input.projectId, client);

  const [row] = await client
    .delete(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, input.milestoneId),
        eq(projectMilestones.projectId, input.projectId),
      ),
    )
    .returning({ id: projectMilestones.id });

  if (!row) {
    throw new DomainError("里程碑不存在或无权访问", "milestones", { key: "milestoneNotFound" });
  }
}

/**
 * 里程碑单字段校验（部分更新用：仅校验传入字段，name 不强制）。
 * 团队/个人服务共用；返回值仅含传入字段。
 */
export function validateMilestoneFields(input: {
  name?: string;
  description?: string;
  dueDate?: string | null;
}): { name?: string; description?: string | null; dueDate?: string | null } {
  const changes: { name?: string; description?: string | null; dueDate?: string | null } = {};

  if (input?.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      throw new DomainError("请输入里程碑名称", "milestones", { key: "milestoneNameRequired" });
    }
    if (name.length > MILESTONE_NAME_MAX_LENGTH) {
      throw new DomainError(
        `里程碑名称不能超过 ${MILESTONE_NAME_MAX_LENGTH} 个字符`,
        "milestones",
        { key: "milestoneNameTooLong", params: { max: MILESTONE_NAME_MAX_LENGTH } },
      );
    }
    changes.name = name;
  }
  if (input?.description !== undefined) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (description.length > MILESTONE_DESCRIPTION_MAX_LENGTH) {
      throw new DomainError(
        `里程碑描述不能超过 ${MILESTONE_DESCRIPTION_MAX_LENGTH} 个字符`,
        "milestones",
        { key: "milestoneDescriptionTooLong", params: { max: MILESTONE_DESCRIPTION_MAX_LENGTH } },
      );
    }
    changes.description = description || null;
  }
  if (input?.dueDate !== undefined) {
    changes.dueDate = input.dueDate ? input.dueDate : null;
  }
  return changes;
}

/** 更新团队项目里程碑（owner/admin）；仅写传入字段，空串日期归 null。 */
export async function updateTeamProjectMilestone(
  input: {
    teamId: string;
    projectId: string;
    milestoneId: string;
    actorId: string;
    name?: string;
    description?: string;
    dueDate?: string | null;
  },
  client: DbClient = db,
): Promise<ProjectMilestone> {
  await requireManageRole(input.teamId, input.actorId, client);
  await requireTeamProjectRow(input.teamId, input.projectId, client);

  const changes = validateMilestoneFields(input);

  const [row] = await client
    .update(projectMilestones)
    .set(changes)
    .where(
      and(
        eq(projectMilestones.id, input.milestoneId),
        eq(projectMilestones.projectId, input.projectId),
      ),
    )
    .returning();

  if (!row) {
    throw new DomainError("里程碑不存在或无权访问", "milestones", { key: "milestoneNotFound" });
  }
  return toMilestone(row);
}

/** 列出团队项目的里程碑：dueDate 升序（PG ASC 默认 NULLS LAST），同日按创建序。 */
export async function listTeamProjectMilestones(
  teamId: string,
  projectId: string,
  client: DbClient = db,
): Promise<ProjectMilestone[]> {
  await requireTeamProjectRow(teamId, projectId, client);

  const rows = await client
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.dueDate), asc(projectMilestones.createdAt));

  return rows.map(toMilestone);
}

/** 列出团队项目成员视图（编辑弹窗池/详情页展示用；owner/admin 校验）。 */
export async function listTeamProjectMembers(
  teamId: string,
  projectId: string,
  client: DbClient = db,
): Promise<ProjectMemberRef[]> {
  await requireTeamProjectRow(teamId, projectId, client);

  const rows = await client
    .select({ userId: projectMembers.userId, name: users.name, image: users.image })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.userId));

  return rows.map((row) => ({ id: row.userId, name: row.name, image: row.image }));
}

export interface MilestoneProgress {
  milestone: ProjectMilestone;
  /** 关联任务总数 */
  taskCount: number;
  /** 关联任务 status='done' 数 */
  doneCount: number;
  /** taskCount === 0 ? 0 : round(done/task*100) */
  percent: number;
}

/** 单空间里程碑进度聚合（tasks join 一次查询）；排序同里程碑列表。个人服务复用。 */
export async function milestoneProgressRows(
  projectId: string,
  client: DbClient,
): Promise<Map<string, { taskCount: number; doneCount: number }>> {
  const rows = await client
    .select({
      milestoneId: tasks.milestoneId,
      taskCount: sql<number>`count(*)::int`.as("task_count"),
      doneCount: sql<number>`(count(*) filter (where ${tasks.status} = 'done'))::int`.as("done_count"),
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .groupBy(tasks.milestoneId);
  const map = new Map<string, { taskCount: number; doneCount: number }>();
  for (const row of rows) {
    if (row.milestoneId) {
      map.set(row.milestoneId, { taskCount: row.taskCount, doneCount: row.doneCount });
    }
  }
  return map;
}

function toMilestoneProgress(
  milestone: ProjectMilestone,
  counts: { taskCount: number; doneCount: number } | undefined,
): MilestoneProgress {
  const taskCount = counts?.taskCount ?? 0;
  const doneCount = counts?.doneCount ?? 0;
  return {
    milestone,
    taskCount,
    doneCount,
    percent: taskCount === 0 ? 0 : Math.round((doneCount / taskCount) * 100),
  };
}

/** 团队空间里程碑进度（概览/侧栏展示）。 */
export async function listProjectMilestonesWithProgress(
  teamId: string,
  projectId: string,
  client: DbClient = db,
): Promise<MilestoneProgress[]> {
  const milestones = await listTeamProjectMilestones(teamId, projectId, client);
  const counts = await milestoneProgressRows(projectId, client);
  return milestones.map((milestone) => toMilestoneProgress(milestone, counts.get(milestone.id)));
}

/** 批量统计项目里程碑数（group by 一次查询，防 N+1）；空集合返回空 Map。 */
export async function milestoneCountsByProjectId(
  projectIds: string[],
  client: DbClient,
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();

  const rows = await client
    .select({
      projectId: projectMilestones.projectId,
      count: sql<number>`count(*)::int`.as("milestone_count"),
    })
    .from(projectMilestones)
    .where(inArray(projectMilestones.projectId, projectIds))
    .groupBy(projectMilestones.projectId);

  return new Map(rows.map((row) => [row.projectId, row.count]));
}

/** 任务聚合输入行:项目维度统计所需的最小字段集。 */
export interface ProjectTaskStatRow {
  projectId: string;
  status: TaskStatus;
  dueDate: string | null;
  subtaskCount: number;
  completedSubtaskCount: number;
}

/** 零值聚合(空项目)。 */
export function emptyProjectStats(): ProjectStats {
  return {
    progress: 0,
    taskCount: 0,
    doneCount: 0,
    overdueCount: 0,
    dueSoonCount: 0,
  };
}

/**
 * 把单个项目的任务行聚合为 `ProjectStats`。
 *
 * 进度 = 各任务进度等权平均(空项目 0);逾期/临期只统计未完成任务,
 * 判定走 types 的 `isOverdue` / `isDueSoon`(与 team-overview 同源)。
 */
export function buildProjectStats(
  rows: ProjectTaskStatRow[],
  today: string,
): ProjectStats {
  const stats = emptyProjectStats();
  if (rows.length === 0) return stats;

  const progresses: number[] = [];
  for (const row of rows) {
    progresses.push(
      getTaskProgress({
        status: row.status,
        subtasks: Array.from({ length: row.subtaskCount }, (_, i) => ({
          completed: i < row.completedSubtaskCount,
        })),
      }),
    );
    stats.taskCount += 1;
    if (row.status === "done") stats.doneCount += 1;
    if (row.dueDate && isOverdue(row.dueDate, row.status, today)) {
      stats.overdueCount += 1;
    }
    if (row.dueDate && isDueSoon(row.dueDate, row.status, today)) {
      stats.dueSoonCount += 1;
    }
  }
  stats.progress = averageProjectProgress(progresses);
  return stats;
}

/**
 * 查询给定项目集合的任务统计行(子任务计数用派生表一次 group by,防 N+1;
 * 与 team-overview 的任务快照同一模式)。空集合直接返回空,避免无谓 `IN ()`。
 */
export async function listProjectTaskStatRows(
  projectIds: string[],
  client: DbClient,
): Promise<ProjectTaskStatRow[]> {
  if (projectIds.length === 0) return [];

  const subtaskStats = client
    .select({
      taskId: subtasks.taskId,
      subtaskCount: sql<number>`count(*)::int`.as("subtask_count"),
      completedSubtaskCount:
        sql<number>`(count(*) filter (where ${subtasks.completed}))::int`.as(
          "completed_subtask_count",
        ),
    })
    .from(subtasks)
    .groupBy(subtasks.taskId)
    .as("subtask_stats");

  const rows = await client
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      dueDate: tasks.dueDate,
      subtaskCount: sql<number>`coalesce(${subtaskStats.subtaskCount}, 0)::int`,
      completedSubtaskCount: sql<number>`coalesce(${subtaskStats.completedSubtaskCount}, 0)::int`,
    })
    .from(tasks)
    .leftJoin(subtaskStats, eq(subtaskStats.taskId, tasks.id))
    .where(inArray(tasks.projectId, projectIds));

  return rows.flatMap((row) =>
    row.projectId === null
      ? []
      : [
          {
            projectId: row.projectId,
            status: row.status,
            dueDate: row.dueDate ?? null,
            subtaskCount: row.subtaskCount,
            completedSubtaskCount: row.completedSubtaskCount,
          },
        ],
  );
}

/**
 * 团队项目列表(创建时间升序),附每项目聚合统计。
 *
 * 权限前置条件:调用方(页面 RSC)必须先用 `getTeamBySlug` + `getMembership`
 * 校验团队存在且当前用户是成员;本函数只按 `teamId` 聚合,不做成员校验。
 * `today` 由调用方注入(Asia/Shanghai 的 `YYYY-MM-DD`)。
 */
export async function getTeamProjectListWithStats(
  teamId: string,
  today: string,
  client: DbClient = db,
): Promise<ProjectListItem[]> {
  const leadUser = alias(users, "lead_user");
  const projectRows = await client
    .select({
      row: projects,
      leadId: projects.leadId,
      leadName: leadUser.name,
      leadImage: leadUser.image,
    })
    .from(projects)
    .leftJoin(leadUser, eq(projects.leadId, leadUser.id))
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.createdAt));

  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((item) => item.row.id);
  const statRows = await listProjectTaskStatRows(projectIds, client);
  const rowsByProject = new Map<string, ProjectTaskStatRow[]>(
    projectIds.map((id) => [id, []]),
  );
  for (const row of statRows) {
    rowsByProject.get(row.projectId)?.push(row);
  }

  const projectTagsMap = await tagsByProjectId(projectIds, client);
  const milestoneCounts = await milestoneCountsByProjectId(projectIds, client);

  // 成员组装：project_members join users 一次查询（防 N+1）。
  const memberRows = await client
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      name: users.name,
      image: users.image,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(inArray(projectMembers.projectId, projectIds))
    .orderBy(asc(projectMembers.userId));
  const membersByProject = new Map<string, ProjectMemberRef[]>(
    projectIds.map((id) => [id, []]),
  );
  for (const row of memberRows) {
    membersByProject.get(row.projectId)?.push({
      id: row.userId,
      // users.name 即展示名（better-auth user 模型口径）
      name: row.name,
      image: row.image,
    });
  }

  return projectRows.map((item) => {
    const lead = item.leadId
      ? { id: item.leadId, name: item.leadName ?? "", image: item.leadImage }
      : null;
    return {
      project: {
        ...toProject(item.row, projectTagsMap.get(item.row.id) ?? []),
        lead,
        members: membersByProject.get(item.row.id) ?? [],
      },
      stats: buildProjectStats(rowsByProject.get(item.row.id) ?? [], today),
      milestoneCount: milestoneCounts.get(item.row.id) ?? 0,
    };
  });
}

/**
 * 项目打标：`tagIds` 全量覆写为项目最终标签集（owner/admin，requireManageRole
 * 由调用方保证——本函数不做角色校验以复用 create/update 的事务上下文）。
 * **只写 project_tags，绝不触碰 projects 行**；tagIds 必须全部属于该团队
 * 标签池且为 project 类型，越界/错配抛 DomainError（tags ns）。
 */
export async function applyProjectTags(
  input: {
    teamId: string;
    projectId: string;
    actorId: string;
    tagIds: string[];
  },
  client: DbClient = db,
): Promise<void> {
  const tagIds = Array.from(new Set(input.tagIds));
  const pool = await getTagsByIds(tagIds, client);
  if (pool.length !== tagIds.length) {
    throw new DomainError("标签不存在或无权访问", "tags", { key: "tagInvalidForSpace" });
  }
  assertTagsBelongToSpace(pool, { teamId: input.teamId });
  assertTagsAreProjectTags(pool);

  await client.transaction(async (tx) => {
    await tx.delete(projectTags).where(
      tagIds.length === 0
        ? eq(projectTags.projectId, input.projectId)
        : and(eq(projectTags.projectId, input.projectId), notInArray(projectTags.tagId, tagIds)),
    );
    if (tagIds.length > 0) {
      await tx
        .insert(projectTags)
        .values(tagIds.map((tagId) => ({ projectId: input.projectId, tagId })))
        .onConflictDoNothing();
    }
  });
}
