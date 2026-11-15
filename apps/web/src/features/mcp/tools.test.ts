import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { VirtualMember } from "@open-doing/types";

import { createTeamProject } from "@/features/projects/service";
import { createTeam } from "@/features/teams/service";
import { createVirtualMember } from "@/features/teams/virtual/service";
import { todayInShanghai } from "@/lib/today";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { comments, notifications, tasks, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import type { ApiTokenContext } from "./api-tokens";
import {
  addComment,
  getTask,
  listProjects,
  listTasks,
  updateTaskStatus,
  whoami,
} from "./tools";

/**
 * Read tools must be scoped strictly by the token's team.
 *
 * Every fixture below creates a second team with its own project, virtual member
 * and tasks so scope-escape attempts (foreign project ids / task ids / virtual
 * member ids) can be proven to return not_found / empty instead of leaking data.
 */

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[mcp/tools.test] TEST_DATABASE_URL is missing; database cases are skipped. Start `docker compose up -d` and export TEST_DATABASE_URL first.",
  );
}

let sequence = 0;

function uniqueName(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

async function createUser(
  db: DbClient,
  username: string,
): Promise<{ id: string; name: string }> {
  const id = crypto.randomUUID();
  const name = `nick-${username}`;
  await db.insert(users).values({
    id,
    uid: generateUid(),
    username,
    name,
    email: `${id}@test.local`,
    displayUsername: username,
  });
  return { id, name };
}

interface ScopedTeamFixture {
  ctx: ApiTokenContext;
  projectAlpha: { id: string; slug: string };
  projectBeta: { id: string; slug: string };
  /** Task ids created in the token team's projects. */
  taskIds: { self: string; real: string; unassignedDone: string; beta: string };
}

interface ForeignTeamFixture {
  owner: { id: string; name: string };
  team: { id: string };
  project: { id: string };
  virtualMember: VirtualMember;
  taskId: string;
}

/** Insert a team task directly so status / assignee / due date are fully controlled. */
async function insertTask(
  db: DbClient,
  input: {
    projectId: string;
    createdById: string;
    title: string;
    status?: "todo" | "in_progress" | "done";
    priority?: "low" | "medium" | "high";
    dueDate?: string | null;
    assigneeId?: string | null;
    assigneeVirtualId?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(tasks).values({
    id,
    projectId: input.projectId,
    spaceType: "team",
    title: input.title,
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    dueDate: input.dueDate ?? null,
    assigneeId: input.assigneeId ?? null,
    assigneeVirtualId: input.assigneeVirtualId ?? null,
    createdById: input.createdById,
  });
  return id;
}

/** All notification rows attached to a task (any recipient / type). */
async function notificationRowsForTask(db: DbClient, taskId: string) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.taskId, taskId));
}

/** Virtual team + two projects + a virtual member (owner is the human behind the token). */
async function setupScopedTeam(db: DbClient): Promise<ScopedTeamFixture> {
  const owner = await createUser(db, uniqueName("owner"));
  const team = await createTeam(
    { name: uniqueName("ScopedTeam"), kind: "virtual" },
    owner.id,
    db,
  );
  const projectAlpha = await createTeamProject(
    { teamId: team.id, actorId: owner.id, name: uniqueName("Alpha") },
    db,
  );
  const projectBeta = await createTeamProject(
    { teamId: team.id, actorId: owner.id, name: uniqueName("Beta") },
    db,
  );
  const virtualMember = await createVirtualMember(
    {
      teamId: team.id,
      actorId: owner.id,
      name: uniqueName("Agent"),
      role: "admin",
      description: "Weekly reports",
      accentColor: "#7d2ae8",
    },
    db,
  );

  const self = await insertTask(db, {
    projectId: projectAlpha.id,
    createdById: owner.id,
    title: "Agent report",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-11-20",
    assigneeVirtualId: virtualMember.id,
  });
  const real = await insertTask(db, {
    projectId: projectAlpha.id,
    createdById: owner.id,
    title: "Owner review",
    status: "todo",
    priority: "low",
    dueDate: "2026-11-10",
    assigneeId: owner.id,
  });
  const unassignedDone = await insertTask(db, {
    projectId: projectAlpha.id,
    createdById: owner.id,
    title: "Unassigned done",
    status: "done",
    dueDate: null,
  });
  const beta = await insertTask(db, {
    projectId: projectBeta.id,
    createdById: owner.id,
    title: "Beta task",
    status: "todo",
    dueDate: "2026-12-01",
    assigneeId: owner.id,
  });

  return {
    ctx: {
      user: { id: owner.id, name: owner.name },
      virtualMember,
      team,
    },
    projectAlpha,
    projectBeta,
    taskIds: { self, real, unassignedDone, beta },
  };
}

/** A completely separate virtual team used for cross-team (scope-escape) assertions. */
async function setupForeignTeam(db: DbClient): Promise<ForeignTeamFixture> {
  const owner = await createUser(db, uniqueName("foreign-owner"));
  const team = await createTeam(
    { name: uniqueName("ForeignTeam"), kind: "virtual" },
    owner.id,
    db,
  );
  const project = await createTeamProject(
    { teamId: team.id, actorId: owner.id, name: uniqueName("ForeignProject") },
    db,
  );
  const virtualMember = await createVirtualMember(
    { teamId: team.id, actorId: owner.id, name: uniqueName("ForeignAgent") },
    db,
  );
  const taskId = await insertTask(db, {
    projectId: project.id,
    createdById: owner.id,
    title: "Foreign task",
    dueDate: "2026-11-05",
    assigneeVirtualId: virtualMember.id,
  });

  return { owner, team, project, virtualMember, taskId };
}

describe.skipIf(!hasTestDatabase)("MCP tools", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("whoami", () => {
    it("returns the virtual member, team, scoped projects and Shanghai date", async () => {
      const { ctx, projectAlpha, projectBeta } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      const result = await whoami(ctx, db);

      expect(result.virtualMember).toEqual({
        name: ctx.virtualMember.name,
        role: "admin",
        description: "Weekly reports",
      });
      expect(result.team).toEqual({ name: ctx.team.name, slug: ctx.team.slug });
      expect(result.projects.map((project) => project.id)).toEqual([
        projectAlpha.id,
        projectBeta.id,
      ]);
      expect(result.projects.map((project) => project.slug)).toEqual([
        projectAlpha.slug,
        projectBeta.slug,
      ]);
      // Foreign projects must never appear.
      expect(result.projects.map((project) => project.id)).not.toContain(
        foreign.project.id,
      );
      expect(result.today).toBe(todayInShanghai());
      expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.hint).toBe("All queries are scoped to this team.");
    });
  });

  describe("list_projects", () => {
    it("returns only the token team's projects with aggregated progress", async () => {
      const { ctx, projectAlpha, projectBeta } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      const result = await listProjects(ctx, db);

      expect(result.map((project) => project.id)).toEqual([
        projectAlpha.id,
        projectBeta.id,
      ]);
      // Alpha: in_progress 0.5 + todo 0 + done 1 => average 0.5.
      expect(result.find((project) => project.id === projectAlpha.id)?.progress).toBe(
        0.5,
      );
      expect(result.find((project) => project.id === projectBeta.id)?.progress).toBe(0);
      expect(result.map((project) => project.id)).not.toContain(foreign.project.id);
    });
  });

  describe("list_tasks scope isolation", () => {
    it("never returns tasks belonging to another team", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      const result = await listTasks(ctx, {}, db);

      expect(result.map((task) => task.id).sort()).toEqual(
        [
          taskIds.self,
          taskIds.real,
          taskIds.unassignedDone,
          taskIds.beta,
        ].sort(),
      );
      expect(result.map((task) => task.id)).not.toContain(foreign.taskId);
    });

    it("a foreign projectId filter yields an empty list", async () => {
      const { ctx } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      expect(await listTasks(ctx, { projectId: foreign.project.id }, db)).toEqual([]);
    });

    it("a malformed projectId yields an empty list instead of throwing", async () => {
      const { ctx } = await setupScopedTeam(db);

      expect(await listTasks(ctx, { projectId: "not-a-uuid" }, db)).toEqual([]);
    });

    it("returns the task summary shape", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const result = await listTasks(ctx, {}, db);
      const self = result.find((task) => task.id === taskIds.self);

      expect(self).toEqual({
        id: taskIds.self,
        title: "Agent report",
        status: "in_progress",
        priority: "high",
        dueDate: "2026-11-20",
        assigneeName: ctx.virtualMember.name,
        projectId: result.find((task) => task.id === taskIds.self)?.projectId,
      });
      expect(self?.projectId).toBeTruthy();
    });
  });

  describe("list_tasks assignee filters", () => {
    it('assignee "self" returns only the token virtual member tasks', async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const result = await listTasks(ctx, { assignee: "self" }, db);

      expect(result.map((task) => task.id)).toEqual([taskIds.self]);
    });

    it('assignee "none" returns only fully unassigned tasks', async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const result = await listTasks(ctx, { assignee: "none" }, db);

      expect(result.map((task) => task.id)).toEqual([taskIds.unassignedDone]);
    });

    it('assignee "any" excludes fully unassigned tasks', async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const result = await listTasks(ctx, { assignee: "any" }, db);

      expect(result.map((task) => task.id).sort()).toEqual(
        [taskIds.self, taskIds.real, taskIds.beta].sort(),
      );
    });

    it("a virtualMemberId inside the team filters by that member", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const result = await listTasks(
        ctx,
        { assignee: { virtualMemberId: ctx.virtualMember.id } },
        db,
      );

      expect(result.map((task) => task.id)).toEqual([taskIds.self]);
    });

    it("a virtualMemberId from another team yields an empty list", async () => {
      const { ctx } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      expect(
        await listTasks(ctx, { assignee: { virtualMemberId: foreign.virtualMember.id } }, db),
      ).toEqual([]);
    });
  });

  describe("list_tasks status / dueBefore filters", () => {
    it("filters by status inside the token team", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      expect(
        (await listTasks(ctx, { status: "done" }, db)).map((task) => task.id),
      ).toEqual([taskIds.unassignedDone]);
      expect(
        (await listTasks(ctx, { status: "in_progress" }, db)).map((task) => task.id),
      ).toEqual([taskIds.self]);
    });

    it("dueBefore is inclusive and excludes tasks without a due date", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      expect(
        (await listTasks(ctx, { dueBefore: "2026-11-15" }, db)).map((task) => task.id),
      ).toEqual([taskIds.real]);
      // Inclusive boundary: the exact due date is still returned.
      expect(
        (await listTasks(ctx, { dueBefore: "2026-11-10" }, db)).map((task) => task.id),
      ).toEqual([taskIds.real]);
      expect(
        (await listTasks(ctx, { dueBefore: "2026-12-01" }, db)).map((task) => task.id),
      ).toEqual([taskIds.real, taskIds.self, taskIds.beta]);
    });
  });

  describe("get_task", () => {
    it("returns full detail for a task in the token team", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const detail = await getTask(ctx, taskIds.self, db);

      expect(detail).toMatchObject({
        id: taskIds.self,
        title: "Agent report",
        status: "in_progress",
        priority: "high",
        spaceType: "team",
      });
    });

    it("a task from another team is indistinguishable from a missing task", async () => {
      const { ctx } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      expect(await getTask(ctx, foreign.taskId, db)).toBeNull();
      expect(await getTask(ctx, crypto.randomUUID(), db)).toBeNull();
      expect(await getTask(ctx, "not-a-uuid", db)).toBeNull();
    });
  });

  describe("update_task_status", () => {
    it("persists the new status and advances updatedAt", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);
      // Pin a sentinel so the assertion does not depend on DB-vs-JS clock skew.
      const sentinel = new Date("2020-01-01T00:00:00.000Z");
      await db
        .update(tasks)
        .set({ updatedAt: sentinel })
        .where(eq(tasks.id, taskIds.real));

      const result = await updateTaskStatus(
        ctx,
        { taskId: taskIds.real, status: "done" },
        db,
      );

      expect(result).toMatchObject({ id: taskIds.real, status: "done" });
      const [after] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskIds.real));
      expect(after!.status).toBe("done");
      expect(after!.updatedAt.getTime()).toBeGreaterThan(sentinel.getTime());
    });

    it("notifies the task creator once with the agent as virtual actor", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      await updateTaskStatus(ctx, { taskId: taskIds.real, status: "done" }, db);

      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.taskId, taskIds.real),
            eq(notifications.type, "task_changed_by_agent"),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: ctx.user.id,
        actorId: null,
        actorVirtualId: ctx.virtualMember.id,
      });
    });

    it("same-status resubmit is a successful no-op with no new notification", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const first = await updateTaskStatus(
        ctx,
        { taskId: taskIds.real, status: "done" },
        db,
      );
      const second = await updateTaskStatus(
        ctx,
        { taskId: taskIds.real, status: "done" },
        db,
      );

      expect(second).toEqual(first);
      expect(await notificationRowsForTask(db, taskIds.real)).toHaveLength(1);
    });

    it("a task from another team is not_found and leaves no writes behind", async () => {
      const { ctx } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      expect(
        await updateTaskStatus(ctx, { taskId: foreign.taskId, status: "done" }, db),
      ).toBeNull();
      expect(
        await updateTaskStatus(ctx, { taskId: "not-a-uuid", status: "done" }, db),
      ).toBeNull();

      const [row] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, foreign.taskId));
      expect(row!.status).toBe("todo");
      expect(await notificationRowsForTask(db, foreign.taskId)).toHaveLength(0);
    });
  });

  describe("add_comment", () => {
    it("persists every agent comment but only one creator notification", async () => {
      const { ctx, taskIds } = await setupScopedTeam(db);

      const first = await addComment(ctx, { taskId: taskIds.self, content: " 进度 30% " }, db);
      const second = await addComment(ctx, { taskId: taskIds.self, content: "进度 80%" }, db);

      expect(first).toMatchObject({
        taskId: taskIds.self,
        authorId: null,
        authorVirtualId: ctx.virtualMember.id,
        content: "进度 30%",
      });
      expect(second).toMatchObject({
        taskId: taskIds.self,
        authorId: null,
        authorVirtualId: ctx.virtualMember.id,
        content: "进度 80%",
      });

      const commentRows = await db
        .select()
        .from(comments)
        .where(eq(comments.taskId, taskIds.self));
      expect(commentRows).toHaveLength(2);

      const notificationRows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.taskId, taskIds.self),
            eq(notifications.type, "task_commented_by_agent"),
          ),
        );
      expect(notificationRows).toHaveLength(1);
      expect(notificationRows[0]).toMatchObject({
        userId: ctx.user.id,
        actorId: null,
        actorVirtualId: ctx.virtualMember.id,
      });
    });

    it("a task from another team is not_found and stores no comment", async () => {
      const { ctx } = await setupScopedTeam(db);
      const foreign = await setupForeignTeam(db);

      expect(await addComment(ctx, { taskId: foreign.taskId, content: "越权" }, db)).toBeNull();
      expect(await addComment(ctx, { taskId: "not-a-uuid", content: "越权" }, db)).toBeNull();

      const rows = await db
        .select()
        .from(comments)
        .where(eq(comments.taskId, foreign.taskId));
      expect(rows).toHaveLength(0);
      expect(await notificationRowsForTask(db, foreign.taskId)).toHaveLength(0);
    });
  });
});
