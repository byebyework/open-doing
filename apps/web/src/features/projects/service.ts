import type { Project, ProjectStats, TaskStatus } from "@open-doing/types";
import {
  averageProjectProgress,
  getTaskProgress,
  isDueSoon,
  isOverdue,
} from "@open-doing/types";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { DomainError } from "@/lib/domain-error";
import { generateUniqueSlug } from "@/lib/slug";
import type { DbClient } from "@/server/db/client";
import { db } from "@/server/db/client";
import { projects, subtasks, tasks } from "@/server/db/schema";
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
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
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
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
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
    throw new DomainError("项目不存在或无权访问", undefined, { key: "projectNotFound" });
  }
}

/** 项目列表项:项目 + 聚合统计(空间级「项目」列表页)。 */
export interface ProjectListItem {
  project: Project;
  stats: ProjectStats;
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
  const projectRows = await client
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
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

  return projectRows.map((row) => ({
    project: toProject(row),
    stats: buildProjectStats(rowsByProject.get(row.id) ?? [], today),
  }));
}
