import {
  addDays,
  aggregateProjectProgress,
  getTaskProgress,
  isDueSoon,
  isOverdue,
  type TaskStatus,
} from "@open-doing/types";
import { and, asc, eq, sql } from "drizzle-orm";

import { listMembers } from "@/features/teams/service";
import { teamTaskHref } from "@/lib/routes";
import { db, type DbClient } from "@/server/db/client";
import { projects, subtasks, tasks, users } from "@/server/db/schema";

/** 单个项目的健康度（供概览页「项目健康度」区使用）。 */
export interface ProjectHealth {
  projectId: string;
  projectName: string;
  projectSlug: string;
  /** 项目进度 0~1：任务进度等权简单平均；空项目为 0。 */
  progress: number;
  hasOverdue: boolean;
  hasDueSoon: boolean;
  /** 项目全部任务数（含已完成），进度分母。 */
  taskCount: number;
}

/** 风险区任务：未完成且逾期 / 临期。 */
export interface RiskTaskItem {
  id: string;
  title: string;
  dueDate: string;
  kind: "overdue" | "dueSoon";
  /** 责任人用户名；未指派时为 null。 */
  assigneeName: string | null;
  projectName: string;
  href: string;
}

/**
 * 重要节点：未完成任务按截止日期升序的前 10 条（含逾期）。
 *
 * `kind` 三态：逾期（早于今天）/ 临期（今天或明天）/ 未来（更晚）。
 */
export interface MilestoneTaskItem {
  id: string;
  title: string;
  dueDate: string;
  kind: "overdue" | "dueSoon" | "upcoming";
  /** 责任人用户名；未指派时为 null。 */
  assigneeName: string | null;
  projectName: string;
  href: string;
}

/** 重要节点展示条数上限。 */
const MILESTONE_TASK_LIMIT = 10;

/** 成员负载：计数只统计未完成，任务列表用于行内下钻。 */
export interface MemberLoad {
  userId: string;
  username: string;
  inProgress: number;
  dueSoon: number;
  overdue: number;
  tasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    dueDate: string | null;
    projectName: string;
    href: string;
  }>;
}

/** 未指派任务：等待管理员重新分配。 */
export interface UnassignedTaskItem {
  id: string;
  title: string;
  dueDate: string | null;
  projectName: string;
  href: string;
}

/** 团队概览聚合结果。 */
export interface TeamOverview {
  projects: ProjectHealth[];
  riskTasks: RiskTaskItem[];
  milestoneTasks: MilestoneTaskItem[];
  members: MemberLoad[];
  unassigned: UnassignedTaskItem[];
  teamStats: {
    projectCount: number;
    /** 团队整体进度 0~1：全部团队任务进度等权平均；无任务为 0。 */
    avgProgress: number;
    dueSoonCount: number;
    overdueCount: number;
  };
}

/** 团队任务快照：一次查询取齐项目、责任人、子任务计数。 */
interface TeamTaskSnapshot {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  projectId: string;
  projectName: string;
  projectSlug: string;
  subtaskCount: number;
  completedSubtaskCount: number;
}

/**
 * 读取团队全部任务（含项目名、责任人名、子任务计数）。
 *
 * 子任务计数用左联派生表一次 group by 完成，避免逐任务查询（N+1）；
 * 截止日期升序、无日期最后，保证成员下钻 / 未指派区的默认顺序稳定。
 */
async function listTeamTaskSnapshots(
  teamId: string,
  client: DbClient,
): Promise<TeamTaskSnapshot[]> {
  const subtaskStats = client
    .select({
      taskId: subtasks.taskId,
      subtaskCount: sql<number>`count(*)::int`.as("subtask_count"),
      completedSubtaskCount: sql<number>`(count(*) filter (where ${subtasks.completed}))::int`.as(
        "completed_subtask_count",
      ),
    })
    .from(subtasks)
    .groupBy(subtasks.taskId)
    .as("subtask_stats");

  const rows = await client
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      assigneeName: users.username,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      subtaskCount: sql<number>`coalesce(${subtaskStats.subtaskCount}, 0)::int`,
      completedSubtaskCount: sql<number>`coalesce(${subtaskStats.completedSubtaskCount}, 0)::int`,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(subtaskStats, eq(subtaskStats.taskId, tasks.id))
    .where(and(eq(tasks.spaceType, "team"), eq(projects.teamId, teamId)))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt));

  return rows.map((row) => ({
    ...row,
    dueDate: row.dueDate ?? null,
    assigneeId: row.assigneeId ?? null,
    assigneeName: row.assigneeName ?? null,
  }));
}

/** 用「子任务计数」还原 `getTaskProgress` 入参，保持进度口径唯一。 */
function taskProgress(task: TeamTaskSnapshot): number {
  return getTaskProgress({
    status: task.status,
    subtasks: Array.from({ length: task.subtaskCount }, (_, index) => ({
      completed: index < task.completedSubtaskCount,
    })),
  });
}

/** 拼团队任务详情链接。 */
function buildTaskHref(input: {
  teamSlug: string;
  projectSlug: string;
  taskId: string;
}): string {
  return teamTaskHref(input.teamSlug, input.projectSlug, input.taskId);
}

/** 风险区排序权重：逾期在前、临期在后。 */
function riskKindRank(kind: RiskTaskItem["kind"]): number {
  return kind === "overdue" ? 0 : 1;
}

/**
 * 重要节点的三态判定：逾期为 dueDate < today；今天或明天为临期；
 * 其余（含更远的未来）为 upcoming。`YYYY-MM-DD` 字典序即日期序。
 */
function milestoneKind(
  dueDate: string,
  today: string,
  tomorrow: string,
): MilestoneTaskItem["kind"] {
  if (dueDate < today) return "overdue";
  if (dueDate === today || dueDate === tomorrow) return "dueSoon";
  return "upcoming";
}

/** `YYYY-MM-DD` 升序，无日期排最后。 */
function compareDueDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/**
 * 聚合团队概览（D-2/D-3）。
 *
 * **权限前置条件**：调用方（`space/[teamSlug]/dashboard/page.tsx`）必须先用
 * `getTeamBySlug` + `getMembership` 校验团队存在且当前用户是成员，
 * 非成员一律 404。本函数只按 `teamId` 聚合，不做成员校验，也绝不
 * 接受前端传入的角色位——因此不能直接暴露为公开 API。
 *
 * 项目健康度、风险区、重要节点、成员负载、未指派区都从**同一次团队任务查询**
 * 在 JS 侧分组得到：团队规模有界（单团队任务量远小于全库），换取
 * 一次查询 + 口径统一；若未来单团队任务量级增长，可再拆成独立聚合 SQL。
 */
export async function getTeamOverview(
  input: { teamId: string; teamSlug: string; today: string },
  client: DbClient = db,
): Promise<TeamOverview> {
  const { teamId, teamSlug, today } = input;
  const tomorrow = addDays(today, 1);

  const [projectRows, taskRows, memberViews] = await Promise.all([
    client
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(eq(projects.teamId, teamId))
      .orderBy(asc(projects.createdAt)),
    listTeamTaskSnapshots(teamId, client),
    listMembers(teamId, client),
  ]);

  // 项目聚合累加器：先铺满全部项目（含空项目），再按任务回填。
  const projectAccumulators = new Map(
    projectRows.map((project) => [
      project.id,
      {
        project,
        progresses: [] as number[],
        hasOverdue: false,
        hasDueSoon: false,
        taskCount: 0,
      },
    ]),
  );

  const memberLoads: MemberLoad[] = memberViews.map(({ user }) => ({
    userId: user.id,
    username: user.username,
    inProgress: 0,
    dueSoon: 0,
    overdue: 0,
    tasks: [],
  }));
  const memberLoadById = new Map(memberLoads.map((load) => [load.userId, load]));

  const riskTasks: RiskTaskItem[] = [];
  const milestoneTasks: MilestoneTaskItem[] = [];
  const unassigned: UnassignedTaskItem[] = [];
  const allProgresses: number[] = [];

  for (const task of taskRows) {
    const progress = taskProgress(task);
    allProgresses.push(progress);

    const projectAccumulator = projectAccumulators.get(task.projectId);
    if (projectAccumulator) {
      projectAccumulator.progresses.push(progress);
      projectAccumulator.taskCount += 1;
    }

    // 逾期 / 临期判定统一走 types 中的纯函数；已完成任务两者均为 false。
    const overdue = task.dueDate
      ? isOverdue(task.dueDate, task.status, today)
      : false;
    const dueSoon = task.dueDate
      ? isDueSoon(task.dueDate, task.status, today)
      : false;

    if (projectAccumulator) {
      if (overdue) projectAccumulator.hasOverdue = true;
      if (dueSoon) projectAccumulator.hasDueSoon = true;
    }

    const href = buildTaskHref({
      teamSlug,
      projectSlug: task.projectSlug,
      taskId: task.id,
    });

    if (task.dueDate && (overdue || dueSoon)) {
      riskTasks.push({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        kind: overdue ? "overdue" : "dueSoon",
        assigneeName: task.assigneeName,
        projectName: task.projectName,
        href,
      });
    }

    // 重要节点：未完成且有截止日期的任务（含逾期、临期与更远的未来）。
    if (task.dueDate && task.status !== "done") {
      milestoneTasks.push({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        kind: milestoneKind(task.dueDate, today, tomorrow),
        assigneeName: task.assigneeName,
        projectName: task.projectName,
        href,
      });
    }

    if (task.assigneeId) {
      const load = memberLoadById.get(task.assigneeId);
      if (load) {
        load.tasks.push({
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          projectName: task.projectName,
          href,
        });
        if (overdue) load.overdue += 1;
        if (dueSoon) load.dueSoon += 1;
        if (task.status === "in_progress") load.inProgress += 1;
      }
    } else if (task.status !== "done") {
      // 已完成但未指派的任务不需要重新分配，只保留在项目进度统计中。
      unassigned.push({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        projectName: task.projectName,
        href,
      });
    }
  }

  // 风险区：逾期在前、临期在后，各按 dueDate 升序；同日按标题稳定排序。
  riskTasks.sort(
    (a, b) =>
      riskKindRank(a.kind) - riskKindRank(b.kind) ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.title.localeCompare(b.title),
  );

  // 重要节点：按截止日期升序、同日按标题稳定排序，只保留最早 10 条。
  milestoneTasks.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
  );
  milestoneTasks.splice(MILESTONE_TASK_LIMIT);

  // 未指派区：截止日期升序、无日期最后；同日按标题稳定排序。
  unassigned.sort(
    (a, b) => compareDueDate(a.dueDate, b.dueDate) || a.title.localeCompare(b.title),
  );

  const projectsHealth: ProjectHealth[] = projectRows.map((project) => {
    const accumulator = projectAccumulators.get(project.id)!;

    return {
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      progress: aggregateProjectProgress(
        accumulator.progresses,
        accumulator.taskCount,
      ),
      hasOverdue: accumulator.hasOverdue,
      hasDueSoon: accumulator.hasDueSoon,
      taskCount: accumulator.taskCount,
    };
  });

  return {
    projects: projectsHealth,
    riskTasks,
    milestoneTasks,
    members: memberLoads,
    unassigned,
    teamStats: {
      projectCount: projectRows.length,
      avgProgress: aggregateProjectProgress(allProgresses, allProgresses.length),
      dueSoonCount: riskTasks.filter((task) => task.kind === "dueSoon").length,
      overdueCount: riskTasks.filter((task) => task.kind === "overdue").length,
    },
  };
}
