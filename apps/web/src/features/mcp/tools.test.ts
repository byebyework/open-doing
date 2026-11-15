import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { VirtualMember } from "@open-doing/types";

import { createTeamProject } from "@/features/projects/service";
import { createTeam } from "@/features/teams/service";
import { createVirtualMember } from "@/features/teams/virtual/service";
import { todayInShanghai } from "@/lib/today";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { tasks, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import type { ApiTokenContext } from "./api-tokens";
import { getTask, listProjects, listTasks, whoami } from "./tools";

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

describe.skipIf(!hasTestDatabase)("MCP read tools", () => {
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
});
