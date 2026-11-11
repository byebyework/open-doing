import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getProjectHealthKind } from "@open-doing/types";

import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  comments,
  notifications,
  projects,
  subtasks,
  tasks,
  teamMemberships,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";
import { TeamPermissionError } from "@/features/teams/permissions";
import { createTeam } from "@/features/teams/service";

import {
  createTeamProject,
  deleteTeamProject,
  getTeamProjectBySlug,
  getTeamProjectListWithStats,
  listTeamProjects,
  listTeamProjectsForTeams,
  updateTeamProject,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[projects/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户，避免每个用例都走 better-auth 密码哈希。 */
async function createUser(db: DbClient, username: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, uid: generateUid(), username, name: username, email: `${id}@test.local`, displayUsername: username });
  return { id };
}

/** 同一用例内多次建团队时用户名需唯一，用递增序号兜底。 */
let teamSequence = 0;

/** 建团队并返回 owner 与团队。 */
async function setupTeam(db: DbClient): Promise<{
  owner: { id: string };
  team: { id: string; slug: string };
}> {
  teamSequence += 1;
  const owner = await createUser(db, `owner-${teamSequence}`);
  const team = await createTeam({ name: "Growth Squad" }, owner.id, db);
  return { owner, team };
}

/** 直插成员关系（owner 由 createTeam 自动建立，其他角色用本函数）。 */
async function addMember(
  db: DbClient,
  teamId: string,
  userId: string,
  role: "owner" | "admin" | "member",
): Promise<void> {
  await db.insert(teamMemberships).values({ teamId, userId, role });
}

describe.skipIf(!hasTestDatabase)("团队项目 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("owner 创建项目：slug 由名称生成，teamId 正确且 ownerId 为空", async () => {
    const { owner, team } = await setupTeam(db);

    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Website Revamp", description: "首页改版" },
      db,
    );

    expect(project).toMatchObject({
      teamId: team.id,
      ownerId: null,
      name: "Website Revamp",
      slug: "website-revamp",
      description: "首页改版",
    });
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
  });

  it("admin 可创建；member 与非成员被拒绝", async () => {
    const { owner, team } = await setupTeam(db);
    const admin = await createUser(db, "admin");
    const member = await createUser(db, "member");
    const outsider = await createUser(db, "outsider");
    await addMember(db, team.id, admin.id, "admin");
    await addMember(db, team.id, member.id, "member");

    await expect(
      createTeamProject({ teamId: team.id, actorId: admin.id, name: "Admin Project" }, db),
    ).resolves.toMatchObject({ slug: "admin-project" });

    await expect(
      createTeamProject({ teamId: team.id, actorId: member.id, name: "Member Project" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await expect(
      createTeamProject({ teamId: team.id, actorId: outsider.id, name: "Outsider" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    expect(owner.id).toBeTruthy();
  });

  it("slug 在团队内查重（x、x-2），跨团队互不冲突", async () => {
    const { owner, team } = await setupTeam(db);
    const other = await setupTeam(db);

    const first = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Roadmap" },
      db,
    );
    const second = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Roadmap" },
      db,
    );
    const otherTeamProject = await createTeamProject(
      { teamId: other.team.id, actorId: other.owner.id, name: "Roadmap" },
      db,
    );

    expect(first.slug).toBe("roadmap");
    expect(second.slug).toBe("roadmap-2");
    expect(otherTeamProject.slug).toBe("roadmap");
  });

  it("纯中文名回落为 project，并在团队内递增", async () => {
    const { owner, team } = await setupTeam(db);

    const first = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "官网改版" },
      db,
    );
    const second = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "移动端适配" },
      db,
    );

    expect(first.slug).toBe("project");
    expect(second.slug).toBe("project-2");
  });

  it("名称与描述校验：空名 → field name，描述超长 → field description", async () => {
    const { owner, team } = await setupTeam(db);

    await expect(
      createTeamProject({ teamId: team.id, actorId: owner.id, name: "   " }, db),
    ).rejects.toMatchObject({ name: "DomainError", field: "name" });

    await expect(
      createTeamProject(
        { teamId: team.id, actorId: owner.id, name: "Long", description: "x".repeat(501) },
        db,
      ),
    ).rejects.toMatchObject({ name: "DomainError", field: "description" });
  });

  it("改名不改变 slug，描述清空存 null；member 被拒绝", async () => {
    const { owner, team } = await setupTeam(db);
    const member = await createUser(db, "member");
    await addMember(db, team.id, member.id, "member");

    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Website Revamp", description: "旧描述" },
      db,
    );

    const renamed = await updateTeamProject(
      { teamId: team.id, projectId: project.id, actorId: owner.id, name: "Brand New", description: "" },
      db,
    );

    expect(renamed.slug).toBe(project.slug);
    expect(renamed.name).toBe("Brand New");
    expect(renamed.description).toBeUndefined();

    await expect(
      updateTeamProject({ teamId: team.id, projectId: project.id, actorId: member.id, name: "Nope" }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });

  it("删除项目级联清理任务、子任务、评论与通知；member 被拒绝", async () => {
    const { owner, team } = await setupTeam(db);
    const member = await createUser(db, "member");
    await addMember(db, team.id, member.id, "member");

    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Cascade" },
      db,
    );

    const task = { id: crypto.randomUUID() };
    await db
      .insert(tasks)
      .values({
        id: task.id,
        projectId: project.id,
        spaceType: "team",
        title: "任务",
        assigneeId: owner.id,
        createdById: owner.id,
      });
    await db.insert(subtasks).values({ taskId: task.id, title: "子任务" });
    await db.insert(comments).values({ taskId: task.id, authorId: owner.id, content: "评论" });
    await db.insert(notifications).values({
      userId: owner.id,
      type: "task_assigned",
      taskId: task!.id,
      projectId: project.id,
      teamId: team.id,
      actorId: owner.id,
    });

    await expect(
      deleteTeamProject({ teamId: team.id, projectId: project.id, actorId: member.id }, db),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await deleteTeamProject({ teamId: team.id, projectId: project.id, actorId: owner.id }, db);

    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.projectId, project.id))).toHaveLength(0);
    expect(await db.select().from(subtasks).where(eq(subtasks.taskId, task!.id))).toHaveLength(0);
    expect(await db.select().from(comments).where(eq(comments.taskId, task!.id))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.taskId, task!.id))).toHaveLength(0);
  });

  it("按 slug 读取限定团队：另一团队的同名 slug 返回 null", async () => {
    const { owner, team } = await setupTeam(db);
    const other = await setupTeam(db);

    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Roadmap" },
      db,
    );

    await expect(getTeamProjectBySlug(team.id, project.slug, db)).resolves.toMatchObject({
      id: project.id,
    });
    await expect(getTeamProjectBySlug(other.team.id, project.slug, db)).resolves.toBeNull();
  });

  it("列表：按团队查询与批量查询都只返回对应团队的项目", async () => {
    const { owner, team } = await setupTeam(db);
    const other = await setupTeam(db);

    const alpha = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Alpha" },
      db,
    );
    const beta = await createTeamProject(
      { teamId: other.team.id, actorId: other.owner.id, name: "Beta" },
      db,
    );

    // 显式错开创建时间，固定列表排序语义（避免同一时刻创建导致顺序不确定）。
    await db
      .update(projects)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(projects.id, alpha.id));
    await db
      .update(projects)
      .set({ createdAt: new Date("2026-01-01T00:00:01Z") })
      .where(eq(projects.id, beta.id));

    expect((await listTeamProjects(team.id, db)).map((p) => p.name)).toEqual(["Alpha"]);
    expect((await listTeamProjectsForTeams([team.id, other.team.id], db)).map((p) => p.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(await listTeamProjectsForTeams([], db)).toEqual([]);
  });

  it("归错团队的操作被拒绝：用 A 团队 id 改 B 团队的项目", async () => {
    const { owner, team } = await setupTeam(db);
    const other = await setupTeam(db);

    const project = await createTeamProject(
      { teamId: other.team.id, actorId: other.owner.id, name: "Other" },
      db,
    );

    await expect(
      updateTeamProject(
        { teamId: team.id, projectId: project.id, actorId: owner.id, name: "Hijack" },
        db,
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe.skipIf(!hasTestDatabase)("getTeamProjectListWithStats", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  /** 直插团队任务（spaceType 固定 team）。 */
  async function insertTask(input: {
    projectId: string;
    userId: string;
    status?: "todo" | "in_progress" | "done";
    dueDate?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(tasks).values({
      id,
      projectId: input.projectId,
      spaceType: "team",
      title: "任务",
      status: input.status ?? "todo",
      dueDate: input.dueDate,
      createdById: input.userId,
    });
    return id;
  }

  it("按创建时间升序返回项目,附每项目聚合(进度/任务数/完成数/逾期/临期)", async () => {
    const { owner, team } = await setupTeam(db);
    const projectA = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Alpha" },
      db,
    );
    const projectB = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Beta" },
      db,
    );

    // A:done 任务(进度 1)+ 带 2 子任务完成 1 的 todo(进度 0.5)→ 0.75。
    await insertTask({ projectId: projectA.id, userId: owner.id, status: "done" });
    const taskA2 = await insertTask({ projectId: projectA.id, userId: owner.id });
    await db
      .insert(subtasks)
      .values([
        { taskId: taskA2, title: "子1", completed: true },
        { taskId: taskA2, title: "子2", completed: false },
      ]);

    // B:逾期 todo(进度 0)+ 明天截止的 in_progress(进度 0.5)→ 0.25。
    await insertTask({
      projectId: projectB.id,
      userId: owner.id,
      status: "todo",
      dueDate: "2026-11-09",
    });
    await insertTask({
      projectId: projectB.id,
      userId: owner.id,
      status: "in_progress",
      dueDate: "2026-11-12",
    });

    // 创建顺序需要稳定:显式回填 createdAt。
    await db
      .update(projects)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(projects.id, projectA.id));
    await db
      .update(projects)
      .set({ createdAt: new Date("2026-01-01T00:00:01Z") })
      .where(eq(projects.id, projectB.id));

    const list = await getTeamProjectListWithStats(team.id, "2026-11-11", db);

    expect(list.map((item) => item.project.slug)).toEqual(["alpha", "beta"]);
    expect(list[0]?.stats).toEqual({
      progress: 0.75,
      taskCount: 2,
      doneCount: 1,
      overdueCount: 0,
      dueSoonCount: 0,
    });
    expect(list[1]?.stats).toEqual({
      progress: 0.25,
      taskCount: 2,
      doneCount: 0,
      overdueCount: 1,
      dueSoonCount: 1,
    });
    // 已完成任务不算逾期/临期;B 因有逾期任务判 overdue。
    expect(getProjectHealthKind(list[1]!.stats)).toBe("overdue");
  });

  it("空项目以零值聚合,健康徽标为未开始", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Empty" },
      db,
    );

    const list = await getTeamProjectListWithStats(team.id, "2026-11-11", db);

    expect(list).toHaveLength(1);
    expect(list[0]?.project.id).toBe(project.id);
    expect(list[0]?.stats).toEqual({
      progress: 0,
      taskCount: 0,
      doneCount: 0,
      overdueCount: 0,
      dueSoonCount: 0,
    });
    expect(getProjectHealthKind(list[0]!.stats)).toBe("notStarted");
  });

  it("无项目返回空数组", async () => {
    const { team } = await setupTeam(db);
    expect(await getTeamProjectListWithStats(team.id, "2026-11-11", db)).toEqual([]);
  });
});
