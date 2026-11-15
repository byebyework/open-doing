import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Comment, Task, TaskStatus } from "@open-doing/types";
import { and, asc, eq, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { TaskDetailModel } from "@/components/ui/task-detail/types";
import {
  getTeamProjectListWithStats,
  listTeamProjects,
} from "@/features/projects/service";
import {
  addTeamComment,
  getTeamTaskDetail,
  updateTeamTask,
} from "@/features/tasks/service";
import { DomainError } from "@/lib/domain-error";
import { COMMENT_MAX_LENGTH, isUuid } from "@/lib/task-fields";
import { todayInShanghai } from "@/lib/today";
import { db, type DbClient } from "@/server/db/client";
import {
  projects,
  tasks,
  users,
  virtualMembers,
} from "@/server/db/schema";

import type { ApiTokenContext } from "./api-tokens";

/**
 * MCP tools (Task 16 read + Task 17 write).
 *
 * Scope rule: the token's team is the ONLY scope. No tool accepts a teamId
 * (or a caller-supplied actor id); every query filters on `ctx.team.id` and
 * service calls use `ctx.user.id` as the actor. Cross-team ids therefore
 * behave exactly like missing ids: `get_task` returns `not_found`, list
 * filters return an empty list.
 *
 * Handlers never throw raw errors at the client: known conditions produce a
 * structured `{ error }` payload, and unexpected failures collapse to
 * `internal_error` so database details never reach the client.
 */

/** Fixed English note returned by `whoami`; all tools are team-scoped by token. */
export const TEAM_SCOPE_HINT = "All queries are scoped to this team.";

const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Input accepted by `list_tasks` (also used directly by tests). */
export interface ListTasksInput {
  projectId?: string;
  status?: TaskStatus;
  assignee?:
    | "self"
    | "any"
    | "none"
    | { virtualMemberId: string };
  /** Inclusive upper bound on due date, `YYYY-MM-DD` (Asia/Shanghai calendar). */
  dueBefore?: string;
}

export interface McpWhoamiResult {
  virtualMember: {
    name: string;
    role: "admin" | "member";
    description: string | null;
  };
  team: { name: string; slug: string };
  projects: { id: string; name: string; slug: string }[];
  today: string;
  hint: string;
}

export interface McpProjectSummary {
  id: string;
  name: string;
  slug: string;
  /** Aggregated task progress, 0..1. */
  progress: number;
}

export interface McpTaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  assigneeName: string | null;
  projectId: string | null;
}

/**
 * Identity summary: virtual member, team, team projects and the Shanghai
 * "today" used for overdue/due-soon reasoning.
 */
export async function whoami(
  ctx: ApiTokenContext,
  client: DbClient = db,
): Promise<McpWhoamiResult> {
  const projectList = await listTeamProjects(ctx.team.id, client);

  return {
    virtualMember: {
      name: ctx.virtualMember.name,
      role: ctx.virtualMember.role,
      description: ctx.virtualMember.description ?? null,
    },
    team: { name: ctx.team.name, slug: ctx.team.slug },
    projects: projectList.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
    })),
    today: todayInShanghai(),
    hint: TEAM_SCOPE_HINT,
  };
}

/**
 * Team projects with aggregated progress.
 *
 * `getTeamProjectListWithStats` already aggregates per project in one grouped
 * query, so progress is cheap to include (no per-project round trip).
 */
export async function listProjects(
  ctx: ApiTokenContext,
  client: DbClient = db,
): Promise<McpProjectSummary[]> {
  const list = await getTeamProjectListWithStats(
    ctx.team.id,
    todayInShanghai(),
    client,
  );

  return list.map(({ project, stats }) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    progress: stats.progress,
  }));
}

/**
 * Tasks in the token team's projects, optionally filtered.
 *
 * Scoping is done by joining `projects` and requiring
 * `projects.team_id = ctx.team.id`, so a foreign projectId / virtualMemberId
 * can only ever produce an empty list. Filters are ANDed; unparseable ids
 * return empty instead of reaching PostgreSQL as invalid uuid casts.
 */
export async function listTasks(
  ctx: ApiTokenContext,
  input: ListTasksInput,
  client: DbClient = db,
): Promise<McpTaskSummary[]> {
  const conditions: SQL[] = [
    eq(tasks.spaceType, "team"),
    eq(projects.teamId, ctx.team.id),
  ];

  if (input.projectId !== undefined) {
    if (!isUuid(input.projectId)) return [];
    conditions.push(eq(tasks.projectId, input.projectId));
  }

  if (input.status !== undefined) {
    conditions.push(eq(tasks.status, input.status));
  }

  if (input.dueBefore !== undefined) {
    conditions.push(lte(tasks.dueDate, input.dueBefore));
  }

  if (input.assignee !== undefined) {
    const assignee = input.assignee;

    if (assignee === "self") {
      conditions.push(eq(tasks.assigneeVirtualId, ctx.virtualMember.id));
    } else if (assignee === "any") {
      conditions.push(
        or(isNotNull(tasks.assigneeId), isNotNull(tasks.assigneeVirtualId))!,
      );
    } else if (assignee === "none") {
      conditions.push(
        and(isNull(tasks.assigneeId), isNull(tasks.assigneeVirtualId))!,
      );
    } else {
      const virtualMemberId = assignee.virtualMemberId;
      if (!isUuid(virtualMemberId)) return [];

      // Validate the virtual member belongs to the token team; foreign ids
      // must not reveal whether the member exists.
      const [member] = await client
        .select({ id: virtualMembers.id })
        .from(virtualMembers)
        .where(
          and(
            eq(virtualMembers.id, virtualMemberId),
            eq(virtualMembers.teamId, ctx.team.id),
          ),
        )
        .limit(1);
      if (!member) return [];

      conditions.push(eq(tasks.assigneeVirtualId, virtualMemberId));
    }
  }

  const rows = await client
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      assigneeUsername: users.username,
      assigneeNickname: users.name,
      assigneeVirtualName: virtualMembers.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(virtualMembers, eq(tasks.assigneeVirtualId, virtualMembers.id))
    .where(and(...conditions))
    // `date` columns sort nulls first by default; keep undated tasks last.
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate ?? null,
    // Display name: nickname -> username -> virtual member name.
    assigneeName:
      row.assigneeNickname ?? row.assigneeUsername ?? row.assigneeVirtualName ?? null,
    projectId: row.projectId,
  }));
}

/**
 * Full task detail, or null for unknown / out-of-team / personal tasks.
 *
 * `getTeamTaskDetail` already filters by `projects.team_id` and returns null
 * uniformly, which is exactly the no-existence-leak behavior required here.
 */
export async function getTask(
  ctx: ApiTokenContext,
  taskId: string,
  client: DbClient = db,
): Promise<TaskDetailModel | null> {
  return getTeamTaskDetail(
    { teamId: ctx.team.id, taskId, actorId: ctx.user.id },
    client,
  );
}

/** `requireTeamTask` raises this key for unknown / out-of-team / malformed task ids. */
function isTaskNotFound(error: unknown): boolean {
  return error instanceof DomainError && error.i18n?.key === "taskNotFound";
}

/**
 * Update a team task's status as the token's virtual member.
 *
 * Authorization is unchanged: `actorId` stays the human behind the token
 * (`updateTeamTask` enforces membership / `task:edit`), while
 * `actorVirtualId` only signs the agent-activity notification sent to the
 * task creator. Same-status resubmission is a no-op success.
 *
 * Returns null for unknown / out-of-team / malformed task ids so callers can
 * answer a uniform `not_found`.
 */
export async function updateTaskStatus(
  ctx: ApiTokenContext,
  input: { taskId: string; status: TaskStatus },
  client: DbClient = db,
): Promise<Task | null> {
  try {
    return await updateTeamTask(
      {
        teamId: ctx.team.id,
        taskId: input.taskId,
        actorId: ctx.user.id,
        status: input.status,
        actorVirtualId: ctx.virtualMember.id,
      },
      client,
    );
  } catch (error) {
    if (isTaskNotFound(error)) return null;
    throw error;
  }
}

/**
 * Comment on a team task as the token's virtual member.
 *
 * `authorVirtualId` signs the comment (and the agent-activity notification to
 * the task creator); permission checks still run against the token's human
 * `actorId`. Returns null for unknown / out-of-team / malformed task ids.
 */
export async function addComment(
  ctx: ApiTokenContext,
  input: { taskId: string; content: string },
  client: DbClient = db,
): Promise<Comment | null> {
  try {
    return await addTeamComment(
      {
        teamId: ctx.team.id,
        taskId: input.taskId,
        actorId: ctx.user.id,
        content: input.content,
        authorVirtualId: ctx.virtualMember.id,
      },
      client,
    );
  } catch (error) {
    if (isTaskNotFound(error)) return null;
    throw error;
  }
}

/** Wrap a payload as MCP text content (JSON for machine consumption). */
function jsonResult(payload: unknown, isError = false): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
  if (isError) result.isError = true;
  return result;
}

/**
 * Run a tool body, converting unexpected failures into a structured
 * `internal_error` result. Raw exceptions never reach the MCP client, and
 * database/error text is not echoed.
 */
async function safeToolCall(
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run();
  } catch {
    return jsonResult({ error: "internal_error" }, true);
  }
}

/** Register the read tools for the current token context. */
export function registerReadTools(
  server: McpServer,
  ctx: ApiTokenContext,
): void {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Return the virtual member identity (name, role, description), the team (name, slug), the team's projects, today's date in Asia/Shanghai, and the scope note. All queries are scoped to this team.",
      inputSchema: {},
    },
    async () => safeToolCall(async () => jsonResult(await whoami(ctx))),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List projects in the team this token is scoped to, with aggregated task progress (0..1).",
      inputSchema: {},
    },
    async () => safeToolCall(async () => jsonResult(await listProjects(ctx))),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks in the team this token is scoped to. Optional filters: projectId, status, assignee (self | any | none | { virtualMemberId }) and dueBefore (inclusive, YYYY-MM-DD). Returns id, title, status, priority, dueDate, assigneeName and projectId.",
      inputSchema: {
        projectId: z
          .string()
          .min(1)
          .optional()
          .describe("Project id; must belong to the scoped team."),
        status: z.enum(TASK_STATUSES).optional().describe("Task status filter."),
        assignee: z
          .union([
            z.enum(["self", "any", "none"]),
            z.object({ virtualMemberId: z.string().min(1) }),
          ])
          .optional()
          .describe(
            "self = the token's virtual member; any = assigned to anyone; none = unassigned; { virtualMemberId } = that member in this team.",
          ),
        dueBefore: z
          .string()
          .regex(DATE_PATTERN, "Expected YYYY-MM-DD")
          .optional()
          .describe("Inclusive due-date upper bound (YYYY-MM-DD)."),
      },
    },
    async (args) =>
      safeToolCall(async () => jsonResult(await listTasks(ctx, args))),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description:
        "Get the full detail of a task (subtasks, comments, progress, assignees) in the team this token is scoped to. Unknown or out-of-scope task ids return { error: \"not_found\" }.",
      inputSchema: {
        taskId: z.string().min(1).describe("Task id."),
      },
    },
    async ({ taskId }) =>
      safeToolCall(async () => {
        const detail = await getTask(ctx, taskId);
        return detail
          ? jsonResult(detail)
          : jsonResult({ error: "not_found" }, true);
      }),
  );
}

/**
 * Register the write tools for the current token context.
 *
 * Same scope contract as the read tools: no caller-supplied team or actor
 * ids — the token's team and virtual member are implicit. Unknown or
 * out-of-team task ids answer the same `not_found` as missing ids.
 */
export function registerWriteTools(
  server: McpServer,
  ctx: ApiTokenContext,
): void {
  server.registerTool(
    "update_task_status",
    {
      title: "Update task status",
      description:
        'Update the status of a task in the team this token is scoped to. Changing the status notifies the task creator that the agent updated it; resubmitting the current status is a successful no-op. Unknown or out-of-scope task ids return { error: "not_found" }.',
      inputSchema: {
        taskId: z.string().min(1).describe("Task id."),
        status: z.enum(TASK_STATUSES).describe("New task status."),
      },
    },
    async ({ taskId, status }) =>
      safeToolCall(async () => {
        const task = await updateTaskStatus(ctx, { taskId, status });
        return task
          ? jsonResult(task)
          : jsonResult({ error: "not_found" }, true);
      }),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description:
        "Add a comment to a task in the team this token is scoped to. The comment is signed by the token's virtual member and notifies the task creator that the agent commented. Unknown or out-of-scope task ids return { error: \"not_found\" }.",
      inputSchema: {
        taskId: z.string().min(1).describe("Task id."),
        content: z
          .string()
          .trim()
          .min(1)
          .max(COMMENT_MAX_LENGTH)
          .describe("Comment content."),
      },
    },
    async ({ taskId, content }) =>
      safeToolCall(async () => {
        const comment = await addComment(ctx, { taskId, content });
        return comment
          ? jsonResult(comment)
          : jsonResult({ error: "not_found" }, true);
      }),
  );
}

/**
 * MCP tool registration entry point used by the route handler.
 *
 * Keep this signature stable so the stateless route does not change.
 */
export function registerMcpTools(server: McpServer, ctx: ApiTokenContext): void {
  registerReadTools(server, ctx);
  registerWriteTools(server, ctx);
}
