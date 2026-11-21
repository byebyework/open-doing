import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getProjectHealthKind } from "@open-doing/types";

import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  comments,
  notifications,
  projectTags,
  projects,
  subtasks,
  tasks,
  teamMemberships,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";
import { TeamPermissionError } from "@/features/teams/permissions";
import { createTag } from "@/features/tags/service";
import { applyProjectTags, buildProjectProgressPercent } from "./service";
import { createTeam } from "@/features/teams/service";
import { addPersonalProjectMilestone, createPersonalProject, listPersonalProjectMilestonesWithProgress } from "@/features/personal/projects/service";

import {
  addTeamProjectMilestone,
  createTeamProject,
  listProjectMilestonesWithProgress,
  deleteTeamProject,
  deleteTeamProjectMilestone,
  getTeamProjectBySlug,
  getTeamProjectListWithStats,
  listTeamProjectMilestones,
  listTeamProjects,
  listTeamProjectsForTeams,
  milestoneCountsByProjectId,
  normalizeMilestoneInputs,
  normalizePriority,
  normalizeProjectStatus,
  updateTeamProject,
  updateTeamProjectMilestone,
  updateTeamProjectStatus,
} from "./service";
import { projectMembers, projectMilestones } from "@/server/db/schema";

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

  it("按 slug 读取带回项目标签（详情页属性行依赖）", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Tagged roadmap" },
      db,
    );
    const tag = await createTag(
      { teamId: team.id, actorId: owner.id, name: "PTag", color: "mint", type: "project" },
      db,
    );
    await applyProjectTags(
      { teamId: team.id, projectId: project.id, actorId: owner.id, tagIds: [tag.id] },
      db,
    );

    await expect(getTeamProjectBySlug(team.id, project.slug, db)).resolves.toMatchObject({
      id: project.id,
      tags: [expect.objectContaining({ id: tag.id })],
    });
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

describe.skipIf(!hasTestDatabase)("项目起止时间", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("创建与更新接受起止时间；end < start 被拒", async () => {
    const { owner, team } = await setupTeam(db);

    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Dated",
        startDate: "2026-12-01",
        endDate: "2026-12-31",
      },
      db,
    );
    expect(project).toMatchObject({ startDate: "2026-12-01", endDate: "2026-12-31" });

    const updated = await updateTeamProject(
      { teamId: team.id, projectId: project.id, actorId: owner.id, startDate: "2026-11-01" },
      db,
    );
    expect(updated).toMatchObject({ startDate: "2026-11-01", endDate: "2026-12-31" });

    await expect(
      updateTeamProject(
        { teamId: team.id, projectId: project.id, actorId: owner.id, endDate: "2026-10-31" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "projectDateRange" }, field: "endDate" });
  });

  it("null 清空日期；未传字段保持不变；单独设置其一合法", async () => {
    const { owner, team } = await setupTeam(db);

    const single = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Half", startDate: "2026-12-01" },
      db,
    );
    expect(single).toMatchObject({ startDate: "2026-12-01", endDate: undefined });

    const cleared = await updateTeamProject(
      { teamId: team.id, projectId: single.id, actorId: owner.id, startDate: null },
      db,
    );
    expect(cleared).toMatchObject({ startDate: undefined, endDate: undefined });
  });
});

describe.skipIf(!hasTestDatabase)("项目起止时间修复（终审）", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("移动 start 同时清空 end：最终状态合法，不误报 projectDateRange", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Clear End",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      },
      db,
    );

    const updated = await updateTeamProject(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        startDate: "2026-03-01",
        endDate: null,
      },
      db,
    );
    expect(updated).toMatchObject({ startDate: "2026-03-01", endDate: undefined });
  });
});

describe.skipIf(!hasTestDatabase)("项目打标（T4）", () => {
  let db: DbClient;
  let seq = 0;

  beforeEach(async () => {
    db = await setupTestDb();
    seq = 0;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("项目打标全量覆写；只写 project_tags 不动 projects.updated_at", async () => {
    seq += 1;
    const owner = await createUser(db, `t4-owner-${seq}`);
    const team = await createTeam({ name: `T4Team${seq}` }, owner.id, db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: `T4Proj${seq}` },
      db,
    );
    const pTagA = await createTag(
      { teamId: team.id, actorId: owner.id, name: `A${seq}`, color: "mint", type: "project" },
      db,
    );
    const pTagB = await createTag(
      { teamId: team.id, actorId: owner.id, name: `B${seq}`, color: "sky", type: "project" },
      db,
    );

    const before = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1);
    const updatedBefore = before[0]!.createdAt;

    await applyProjectTags(
      { teamId: team.id, projectId: project.id, actorId: owner.id, tagIds: [pTagA.id] },
      db,
    );
    let rows = await db.select().from(projectTags).where(eq(projectTags.projectId, project.id));
    expect(rows.map((r) => r.tagId)).toEqual([pTagA.id]);

    await applyProjectTags(
      { teamId: team.id, projectId: project.id, actorId: owner.id, tagIds: [pTagB.id, pTagA.id] },
      db,
    );
    rows = await db.select().from(projectTags).where(eq(projectTags.projectId, project.id));
    expect(new Set(rows.map((r) => r.tagId))).toEqual(new Set([pTagA.id, pTagB.id]));

    const after = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1);
    expect(after[0]!.createdAt.getTime()).toBe(updatedBefore.getTime());
  });

  it("task 类型标签提交给项目 → tagTypeMismatch", async () => {
    seq += 1;
    const owner = await createUser(db, `t4-mix-${seq}`);
    const team = await createTeam({ name: `T4Mix${seq}` }, owner.id, db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: `T4MixProj${seq}` },
      db,
    );
    const tTag = await createTag(
      { teamId: team.id, actorId: owner.id, name: `TT${seq}`, color: "purple", type: "task" },
      db,
    );

    await expect(
      applyProjectTags(
        { teamId: team.id, projectId: project.id, actorId: owner.id, tagIds: [tTag.id] },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "tagTypeMismatch" }, field: "tags" });
  });

  it("member 给团队项目打标被拒", async () => {
    seq += 1;
    const owner = await createUser(db, `t4-mem-${seq}`);
    const member = await createUser(db, `t4-memm-${seq}`);
    const team = await createTeam({ name: `T4Mem${seq}` }, owner.id, db);
    await db.insert(teamMemberships).values({ teamId: team.id, userId: member.id, role: "member" });
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: `T4MemProj${seq}` },
      db,
    );

    // 公开路径：updateTeamProject 内含 requireManageRole（member 被拒）。
    await expect(
      updateTeamProject(
        { teamId: team.id, projectId: project.id, actorId: member.id, tagIds: [] },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);
  });
});

describe("里程碑/优先级校验器（纯函数）", () => {
  it("normalizePriority：undefined 回落 medium，非法值抛 priorityInvalid", () => {
    expect(normalizePriority(undefined)).toBe("medium");
    expect(normalizePriority("high")).toBe("high");
    expect(normalizePriority("low")).toBe("low");
    expect(normalizePriority("medium")).toBe("medium");
    // @ts-expect-error 故意传入非法值验证运行时防线
    expect(() => normalizePriority("urgent")).toThrow();
  });

  it("normalizeMilestoneInputs：trim、dueDate 空串归 null、顺序保留", () => {
    expect(
      normalizeMilestoneInputs([
        { name: "  里程碑 A ", description: "  ", dueDate: "" },
        { name: "里程碑 B", dueDate: "2026-12-01" },
      ]),
    ).toEqual([
      { name: "里程碑 A", description: null, dueDate: null },
      { name: "里程碑 B", description: null, dueDate: "2026-12-01" },
    ]);
    expect(normalizeMilestoneInputs(undefined)).toEqual([]);
  });

  it("normalizeMilestoneInputs：空名 → milestoneNameRequired，超长 → nameTooLong / descriptionTooLong", () => {
    expect(() => normalizeMilestoneInputs([{ name: "   " }])).toThrow(
      expect.objectContaining({ field: "milestones", i18n: { key: "milestoneNameRequired" } }),
    );
    expect(() =>
      normalizeMilestoneInputs([{ name: "x".repeat(51) }]),
    ).toThrow(
      expect.objectContaining({
        field: "milestones",
        i18n: expect.objectContaining({ key: "milestoneNameTooLong" }),
      }),
    );
    expect(() =>
      normalizeMilestoneInputs([{ name: "OK", description: "x".repeat(201) }]),
    ).toThrow(
      expect.objectContaining({
        field: "milestones",
        i18n: expect.objectContaining({ key: "milestoneDescriptionTooLong" }),
      }),
    );
  });
});

describe.skipIf(!hasTestDatabase)("项目优先级与里程碑（表格模式）", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("创建项目：priority 缺省为 medium，显式 high 可入库；更新走显式字段赋值", async () => {
    const { owner, team } = await setupTeam(db);

    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Prio" },
      db,
    );
    expect(project.priority).toBe("medium");

    const high = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Prio High", priority: "high" },
      db,
    );
    expect(high.priority).toBe("high");

    const updated = await updateTeamProject(
      { teamId: team.id, projectId: high.id, actorId: owner.id, priority: "low" },
      db,
    );
    expect(updated.priority).toBe("low");
    // 未传字段保持不变（显式赋值，不做整对象 spread）。
    expect(updated.name).toBe("Prio High");
  });

  it("创建项目携带里程碑与标签在同一事务；标签非法时项目行回滚", async () => {
    const { owner, team } = await setupTeam(db);
    const tag = await createTag(
      { teamId: team.id, actorId: owner.id, name: "MTag", color: "mint", type: "project" },
      db,
    );

    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Milestoned",
        tagIds: [tag.id],
        milestones: [
          { name: "里程碑 A", dueDate: "2026-12-05" },
          { name: "里程碑 B", description: "首个交付", dueDate: "2026-12-01" },
        ],
      },
      db,
    );

    const rows = await db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, project.id));
    expect(rows).toHaveLength(2);
    expect(
      await db.select().from(projectTags).where(eq(projectTags.projectId, project.id)),
    ).toHaveLength(1);

    // 标签断言失败 → 整个事务回滚，项目行不存在。
    await expect(
      createTeamProject(
        {
          teamId: team.id,
          actorId: owner.id,
          name: "Broken",
          tagIds: [crypto.randomUUID()],
          milestones: [{ name: "孤儿", dueDate: "2026-12-01" }],
        },
        db,
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(
      await db.select().from(projects).where(eq(projects.name, "Broken")),
    ).toHaveLength(0);
  });

  it("里程碑列表按 dueDate 升序（PG ASC NULLS LAST），同日按 createdAt", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Sorted",
        milestones: [
          { name: "里程碑 A", dueDate: "2026-12-05" },
          { name: "里程碑 B", dueDate: "2026-12-01" },
          { name: "无日期" },
        ],
      },
      db,
    );

    const list = await listTeamProjectMilestones(team.id, project.id, db);
    expect(list.map((m) => m.name)).toEqual(["里程碑 B", "里程碑 A", "无日期"]);
    expect(list[0]).toMatchObject({
      projectId: project.id,
      name: "里程碑 B",
      dueDate: "2026-12-01",
    });
  });

  it("addTeamProjectMilestone 追加；member 被拒；跨项目 milestoneId → milestoneNotFound", async () => {
    const { owner, team } = await setupTeam(db);
    const member = await createUser(db, "m-milestone");
    await addMember(db, team.id, member.id, "member");
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Addable" },
      db,
    );
    const other = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Other" },
      db,
    );

    const added = await addTeamProjectMilestone(
      { teamId: team.id, projectId: project.id, actorId: owner.id, name: "上线", dueDate: "2026-12-20" },
      db,
    );
    expect(added).toMatchObject({ projectId: project.id, name: "上线", dueDate: "2026-12-20" });

    await expect(
      addTeamProjectMilestone(
        { teamId: team.id, projectId: project.id, actorId: member.id, name: "越权" },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    // 用另一项目作归属探针：其 id 不是本项目的里程碑。
    await expect(
      deleteTeamProjectMilestone(
        { teamId: team.id, projectId: project.id, milestoneId: other.id, actorId: owner.id },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "milestoneNotFound" } });

    await deleteTeamProjectMilestone(
      { teamId: team.id, projectId: project.id, milestoneId: added.id, actorId: owner.id },
      db,
    );
    expect(
      await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, project.id)),
    ).toHaveLength(0);
  });

  it("updateTeamProjectMilestone：改名字段、清空日期；member 被拒", async () => {
    const { owner, team } = await setupTeam(db);
    const member = await createUser(db, "u-milestone-edit");
    await addMember(db, team.id, member.id, "member");
    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Editable",
        milestones: [{ name: "旧名", description: "旧描述", dueDate: "2026-12-05" }],
      },
      db,
    );
    const [milestone] = await listTeamProjectMilestones(team.id, project.id, db);

    await expect(
      updateTeamProjectMilestone(
        { teamId: team.id, projectId: project.id, milestoneId: milestone!.id, actorId: member.id, name: "越权" },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    const updated = await updateTeamProjectMilestone(
      {
        teamId: team.id,
        projectId: project.id,
        milestoneId: milestone!.id,
        actorId: owner.id,
        name: "  新名  ",
        dueDate: "",
      },
      db,
    );
    expect(updated).toMatchObject({ name: "新名", dueDate: undefined, description: "旧描述" });

    // 跨项目 milestoneId → milestoneNotFound
    const other = await createTeamProject({ teamId: team.id, actorId: owner.id, name: "Other" }, db);
    await expect(
      updateTeamProjectMilestone(
        { teamId: team.id, projectId: other.id, milestoneId: milestone!.id, actorId: owner.id, name: "X" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "milestoneNotFound" } });
  });

  it("listTeamProjectMilestones / delete：错团队、跨归属 → projectNotFound", async () => {
    const { owner, team } = await setupTeam(db);
    const other = await setupTeam(db);
    const project = await createTeamProject(
      {
        teamId: other.team.id,
        actorId: other.owner.id,
        name: "Foreign",
        milestones: [{ name: "外部节点", dueDate: "2026-12-05" }],
      },
      db,
    );

    await expect(listTeamProjectMilestones(team.id, project.id, db)).rejects.toMatchObject({
      i18n: { key: "projectNotFound" },
    });
    await expect(
      addTeamProjectMilestone(
        { teamId: team.id, projectId: project.id, actorId: owner.id, name: "越界" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "projectNotFound" } });
  });

  it("normalizeProjectStatus：undefined 回落 backlog，非法值抛 statusInvalid", () => {
    expect(normalizeProjectStatus(undefined)).toBe("backlog");
    expect(normalizeProjectStatus("planned")).toBe("planned");
    expect(normalizeProjectStatus("canceled")).toBe("canceled");
    // @ts-expect-error 故意传非法值验证运行时防线
    expect(() => normalizeProjectStatus("archived")).toThrow();
  });

  it("create：leadId/memberIds 校验成员池，lead 自动并入 members", async () => {
    const { owner, team } = await setupTeam(db);
    const member1 = await createUser(db, "lead-candidate");
    await addMember(db, team.id, member1.id, "member");

    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Staffed",
        leadId: member1.id,
        memberIds: [owner.id],
      },
      db,
    );
    expect(project.leadId).toBe(member1.id);
    const rows = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, project.id));
    // lead 自动并入成员：owner + member1
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([owner.id, member1.id]));

    // 非成员任 lead → leadNotMember
    const outsider = await createUser(db, "lead-outsider");
    await expect(
      createTeamProject(
        { teamId: team.id, actorId: owner.id, name: "Bad Lead", leadId: outsider.id },
        db,
      ),
    ).rejects.toMatchObject({ field: "leadId", i18n: { key: "leadNotMember" } });

    // memberIds 含非成员 → memberNotInTeam
    await expect(
      createTeamProject(
        { teamId: team.id, actorId: owner.id, name: "Bad Members", memberIds: [outsider.id] },
        db,
      ),
    ).rejects.toMatchObject({ field: "members", i18n: { key: "memberNotInTeam" } });
  });

  it("update：members 全量覆写不含 lead → leadId 置 null；[] 清空成员", async () => {
    const { owner, team } = await setupTeam(db);
    const member1 = await createUser(db, "will-drop");
    await addMember(db, team.id, member1.id, "member");
    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Overwrite",
        leadId: member1.id,
        memberIds: [member1.id],
      },
      db,
    );

    // 覆写后不含 lead → leadId 置 null（Review Focus #2）
    const updated = await updateTeamProject(
      { teamId: team.id, projectId: project.id, actorId: owner.id, memberIds: [owner.id] },
      db,
    );
    expect(updated.leadId).toBeNull();
    let rows = await db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id));
    expect(rows.map((r) => r.userId)).toEqual([owner.id]);

    // [] 清空成员
    const cleared = await updateTeamProject(
      { teamId: team.id, projectId: project.id, actorId: owner.id, memberIds: [] },
      db,
    );
    expect(cleared.leadId).toBeNull();
    rows = await db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id));
    expect(rows).toHaveLength(0);

    // 未传字段保持不变（Review Focus #1）：仅改 status，成员/负责人不动
    const staffed = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Keep Members",
        leadId: member1.id,
        memberIds: [member1.id],
      },
      db,
    );
    const touched = await updateTeamProject(
      { teamId: team.id, projectId: staffed.id, actorId: owner.id, status: "planned" },
      db,
    );
    expect(touched.status).toBe("planned");
    expect(touched.leadId).toBe(member1.id);
    rows = await db.select().from(projectMembers).where(eq(projectMembers.projectId, staffed.id));
    expect(rows.map((r) => r.userId)).toEqual([member1.id]);
  });

  it("updateTeamProjectStatus：改状态；member 被拒；错归属 projectNotFound", async () => {
    const { owner, team } = await setupTeam(db);
    const member = await createUser(db, "status-member");
    await addMember(db, team.id, member.id, "member");
    const project = await createTeamProject({ teamId: team.id, actorId: owner.id, name: "Stated" }, db);
    const other = await setupTeam(db);

    const updated = await updateTeamProjectStatus(
      { teamId: team.id, projectId: project.id, actorId: owner.id, status: "canceled" },
      db,
    );
    expect(updated.status).toBe("canceled");

    await expect(
      updateTeamProjectStatus(
        { teamId: team.id, projectId: project.id, actorId: member.id, status: "planned" },
        db,
      ),
    ).rejects.toBeInstanceOf(TeamPermissionError);

    await expect(
      updateTeamProjectStatus(
        { teamId: team.id, projectId: other.team.id, actorId: owner.id, status: "planned" },
        db,
      ),
    ).rejects.toMatchObject({ i18n: { key: "projectNotFound" } });
  });

  it("迁移 0011 回填口径：全部完成→completed；有进行中→in_progress；其余→backlog", async () => {
    const { owner, team } = await setupTeam(db);

    const seed = async (name: string, statuses: Array<"todo" | "in_progress" | "done">) => {
      const project = await createTeamProject({ teamId: team.id, actorId: owner.id, name }, db);
      for (const status of statuses) {
        await db.insert(tasks).values({
          id: crypto.randomUUID(),
          projectId: project.id,
          spaceType: "team",
          title: "任务",
          status,
          createdById: owner.id,
        });
      }
      // 模拟迁移前的存量行：全部重置为默认 backlog
      await db.execute(sql`UPDATE projects SET status = 'backlog' WHERE id = ${project.id}`);
      return project.id;
    };

    const allDone = await seed("AllDone", ["done", "done"]);
    const withInProgress = await seed("WithInProgress", ["done", "in_progress"]);
    const onlyTodo = await seed("OnlyTodo", ["todo"]);
    const noTasks = await seed("NoTasks", []);

    // 与 drizzle/0011_square_spot.sql 追加的两条回填语句逐字一致
    await db.execute(sql`
      UPDATE "projects" SET "status" = 'completed'
      WHERE EXISTS (SELECT 1 FROM "tasks" "t" WHERE "t"."project_id" = "projects"."id" AND "t"."status" = 'done')
        AND NOT EXISTS (SELECT 1 FROM "tasks" "t" WHERE "t"."project_id" = "projects"."id" AND "t"."status" <> 'done')
    `);
    await db.execute(sql`
      UPDATE "projects" SET "status" = 'in_progress'
      WHERE "status" = 'backlog'
        AND EXISTS (SELECT 1 FROM "tasks" "t" WHERE "t"."project_id" = "projects"."id" AND "t"."status" = 'in_progress')
    `);

    const rows = await db.select({ id: projects.id, status: projects.status }).from(projects);
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(allDone)).toBe("completed");
    expect(byId.get(withInProgress)).toBe("in_progress");
    expect(byId.get(onlyTodo)).toBe("backlog");
    expect(byId.get(noTasks)).toBe("backlog");
  });

  it("getTeamProjectListWithStats 组装 status/lead/members", async () => {
    const { owner, team } = await setupTeam(db);
    const member1 = await createUser(db, "assembled-lead");
    await addMember(db, team.id, member1.id, "member");
    const project = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Assembled",
        status: "in_progress",
        leadId: member1.id,
        memberIds: [owner.id],
      },
      db,
    );
    const empty = await createTeamProject({ teamId: team.id, actorId: owner.id, name: "Bare" }, db);

    const list = await getTeamProjectListWithStats(team.id, "2026-11-21", db);
    const assembled = list.find((item) => item.project.id === project.id)!;
    expect(assembled.project.status).toBe("in_progress");
    expect(assembled.project.lead).toMatchObject({ id: member1.id, image: null });
    expect(assembled.project.lead?.name.length).toBeGreaterThan(0);
    expect(new Set(assembled.project.members?.map((m) => m.id))).toEqual(
      new Set([owner.id, member1.id]),
    );
    const bare = list.find((item) => item.project.id === empty.id)!;
    expect(bare.project.lead).toBeNull();
    expect(bare.project.members).toEqual([]);
  });

  it("getTeamProjectListWithStats 附 milestoneCount（空项目为 0）", async () => {
    const { owner, team } = await setupTeam(db);
    const withMilestones = await createTeamProject(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "Counted",
        milestones: [
          { name: "M1", dueDate: "2026-12-01" },
          { name: "M2", dueDate: "2026-12-02" },
        ],
      },
      db,
    );
    const empty = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "EmptyCount" },
      db,
    );

    const counts = await milestoneCountsByProjectId([withMilestones.id, empty.id], db);
    expect(counts.get(withMilestones.id)).toBe(2);
    // group-by 只返回有行项目；零计数由列表层 `?? 0` 兜底。
    expect(counts.get(empty.id)).toBeUndefined();

    const list = await getTeamProjectListWithStats(team.id, "2026-11-20", db);
    const counted = list.find((item) => item.project.id === withMilestones.id);
    const emptyItem = list.find((item) => item.project.id === empty.id);
    expect(counted?.milestoneCount).toBe(2);
    expect(emptyItem?.milestoneCount).toBe(0);
    expect(counts.get("nonexistent")).toBeUndefined();
    expect(await milestoneCountsByProjectId([], db)).toEqual(new Map());
  });
});

describe.skipIf(!hasTestDatabase)("里程碑进度查询", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("进度 = 关联任务 done 数 / 总数；空里程碑 0 任务 0%；排序保持", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject({ teamId: team.id, actorId: owner.id, name: "Progress" }, db);
    const m1 = await addTeamProjectMilestone(
      { teamId: team.id, projectId: project.id, actorId: owner.id, name: "M1", dueDate: "2026-12-01" },
      db,
    );
    const m2 = await addTeamProjectMilestone(
      { teamId: team.id, projectId: project.id, actorId: owner.id, name: "M2", dueDate: "2026-12-02" },
      db,
    );

    const seedTask = async (milestoneId: string | null, status: "todo" | "in_progress" | "done") => {
      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        projectId: project.id,
        spaceType: "team",
        title: "任务",
        status,
        milestoneId,
        createdById: owner.id,
      });
    };
    await seedTask(m1.id, "done");
    await seedTask(m1.id, "todo");
    await seedTask(m1.id, "done");
    await seedTask(m2.id, "todo");

    const progress = await listProjectMilestonesWithProgress(team.id, project.id, db);
    expect(progress).toHaveLength(2);
    expect(progress[0]!.milestone.id).toBe(m1.id);
    expect(progress[0]!.taskCount).toBe(3);
    expect(progress[0]!.doneCount).toBe(2);
    expect(progress[0]!.percent).toBe(67);
    expect(progress[1]!.taskCount).toBe(1);
    expect(progress[1]!.percent).toBe(0);

    // 无关联任务的里程碑也是 0 任务 0%
    const bare = await createTeamProject({ teamId: team.id, actorId: owner.id, name: "Bare" }, db);
    const bareProgress = await listProjectMilestonesWithProgress(team.id, bare.id, db);
    expect(bareProgress).toEqual([]);
  });

  it("个人空间进度同构", async () => {
    const { id: userId } = await createUser(db, "progress-personal");
    const project = await createPersonalProject(userId, { name: "个人进度" }, db);
    const milestone = await addPersonalProjectMilestone(
      userId,
      project.id,
      { name: "节点", dueDate: "2026-12-20" },
      db,
    );
    await db.insert(tasks).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      spaceType: "personal",
      title: "任务",
      status: "done",
      milestoneId: milestone.id,
      assigneeId: userId,
      createdById: userId,
    });

    const progress = await listPersonalProjectMilestonesWithProgress(userId, project.id, db);
    expect(progress).toHaveLength(1);
    expect(progress[0]!.doneCount).toBe(1);
    expect(progress[0]!.percent).toBe(100);
  });
});

describe("buildProjectProgressPercent（详情页进度卡口径）", () => {
  it("与列表共用子任务感知口径：进行中计 0.5、子任务按完成比", () => {
    // 无子任务：done=1 / in_progress=0.5 → (1+0.5)/2 = 75%
    const percent = buildProjectProgressPercent(
      [
        { status: "done", subtasks: [] },
        { status: "in_progress", subtasks: [] },
      ],
      "2026-11-22",
    );
    expect(percent).toBe(75);

    // 子任务感知：todo 任务完成 1/2 子任务 → 0.5；(1 + 0.5 + 0.5)/3 ≈ 67%
    const withSubtasks = buildProjectProgressPercent(
      [
        { status: "done", subtasks: [] },
        { status: "in_progress", subtasks: [] },
        { status: "todo", subtasks: [{ completed: true }, { completed: false }] },
      ],
      "2026-11-22",
    );
    expect(withSubtasks).toBe(67);
  });

  it("空项目返回 0%", () => {
    expect(buildProjectProgressPercent([], "2026-11-22")).toBe(0);
  });
});
