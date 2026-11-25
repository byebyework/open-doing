import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { TAG_COLORS } from "@open-doing/types";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  projectActivities,
  projectComments,
  projects,
  tags,
  teamMemberships,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";
import { createTag } from "@/features/tags/service";
import { createTeam } from "@/features/teams/service";

import {
  listProjectTimeline,
  resolveTagRefs,
  resolveUserRefs,
} from "./activities";
import {
  addPersonalProjectMilestone,
  createPersonalProject,
  deletePersonalProjectMilestone,
  updatePersonalProject,
  updatePersonalProjectMilestone,
  updatePersonalProjectStatus,
} from "@/features/personal/projects/service";

import {
  addTeamProjectMilestone,
  createTeamProject,
  deleteTeamProjectMilestone,
  updateTeamProject,
  updateTeamProjectMilestone,
  updateTeamProjectStatus,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[projects/activities.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户，避免走 better-auth 密码哈希（同 service.test 口径）。 */
async function createUser(
  db: DbClient,
  username: string,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    uid: generateUid(),
    username,
    name: username,
    email: `${id}@test.local`,
    displayUsername: username,
  });
  return { id };
}

/** 直插个人项目（活动/评论外键的目标行）。 */
async function createPersonalProjectRow(
  db: DbClient,
  ownerId: string,
  slug: string,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.insert(projects).values({ id, ownerId, name: slug, slug });
  return { id };
}

/** 建团队 + owner（同 service.test 口径）。 */
async function setupTeam(db: DbClient): Promise<{
  owner: { id: string };
  team: { id: string; slug: string };
}> {
  const owner = await createUser(db, `owner-${crypto.randomUUID().slice(0, 8)}`);
  const team = await createTeam({ name: `Team ${crypto.randomUUID().slice(0, 8)}` }, owner.id, db);
  return { owner, team };
}

/** 直插团队成员关系（owner 由 createTeam 建立）。 */
async function addTeamMember(
  db: DbClient,
  teamId: string,
  userId: string,
  role: "admin" | "member",
): Promise<void> {
  await db.insert(teamMemberships).values({ teamId, userId, role });
}

/** 读取某项目的全部活动行。 */
async function listActivityRows(db: DbClient, projectId: string) {
  return db
    .select()
    .from(projectActivities)
    .where(eq(projectActivities.projectId, projectId));
}

describe.skipIf(!hasTestDatabase)("项目活动基础设施", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("project_activities / project_comments 建表回环", async () => {
    const user = await createUser(db, "act-owner");
    const project = await createPersonalProjectRow(db, user.id, "act-project");

    await db
      .insert(projectActivities)
      .values({ projectId: project.id, actorId: user.id, type: "created" });
    await db
      .insert(projectComments)
      .values({ projectId: project.id, authorId: user.id, content: "hi" });

    const activities = await db
      .select()
      .from(projectActivities)
      .where(eq(projectActivities.projectId, project.id));
    const comments = await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.projectId, project.id));

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ type: "created", actorId: user.id });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ content: "hi", authorId: user.id });
  });

  it("listProjectTimeline 合并活动与评论按时间倒序，limit 生效", async () => {
    const user = await createUser(db, "tl-owner");
    const project = await createPersonalProjectRow(db, user.id, "tl-project");

    await db.insert(projectActivities).values([
      {
        projectId: project.id,
        actorId: user.id,
        type: "created",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        projectId: project.id,
        actorId: user.id,
        type: "status",
        payload: { kind: "scalar", from: "backlog", to: "in_progress" },
        createdAt: new Date("2026-01-03T00:00:00Z"),
      },
    ]);
    await db.insert(projectComments).values({
      projectId: project.id,
      authorId: user.id,
      content: "mid",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });

    const all = await listProjectTimeline(project.id, {}, db);
    expect(all.map((item) => item.kind)).toEqual([
      "activity",
      "comment",
      "activity",
    ]);
    expect(all[0]).toMatchObject({ kind: "activity", type: "status" });
    expect(all[1]).toMatchObject({ kind: "comment", content: "mid" });

    const limited = await listProjectTimeline(project.id, { limit: 2 }, db);
    expect(limited).toHaveLength(2);
    expect(limited[0]).toMatchObject({ type: "status" });
    expect(limited[1]).toMatchObject({ kind: "comment" });
  });

  it("actor / author 姓名在读取时解析", async () => {
    const user = await createUser(db, "Act Name");
    const project = await createPersonalProjectRow(db, user.id, "name-project");

    await db.insert(projectActivities).values({
      projectId: project.id,
      actorId: user.id,
      type: "created",
    });
    await db.insert(projectComments).values({
      projectId: project.id,
      authorId: user.id,
      content: "c",
    });

    const items = await listProjectTimeline(project.id, {}, db);
    const activityItem = items.find((item) => item.kind === "activity");
    const commentItem = items.find((item) => item.kind === "comment");
    expect(activityItem).toMatchObject({
      kind: "activity",
      actor: { id: user.id, name: "Act Name" },
    });
    expect(commentItem).toMatchObject({
      kind: "comment",
      author: { id: user.id, name: "Act Name" },
    });
  });

  it("resolveUserRefs / resolveTagRefs 返回已知 id 的 name，未知 id 丢弃", async () => {
    const owner = await createUser(db, "ref-owner");
    const other = await createUser(db, "ref-other");
    await db.insert(tags).values({
      ownerId: owner.id,
      name: "Urgent",
      color: TAG_COLORS[0],
      type: "project",
    });
    const tagRow = (
      await db.select().from(tags).where(eq(tags.ownerId, owner.id))
    )[0];

    const usersResolved = await resolveUserRefs(
      [owner.id, other.id, crypto.randomUUID()],
      db,
    );
    expect(usersResolved).toEqual([
      { id: owner.id, name: "ref-owner" },
      { id: other.id, name: "ref-other" },
    ]);

    const tagsResolved = await resolveTagRefs(
      [tagRow.id, crypto.randomUUID()],
      db,
    );
    expect(tagsResolved).toEqual([{ id: tagRow.id, name: "Urgent" }]);
  });

  it("createTeamProject 落 created 事件", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Act Web" },
      db,
    );

    const rows = await listActivityRows(db, project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "created",
      actorId: owner.id,
      payload: null,
    });
  });

  it("updateTeamProject 多字段一次保存拆多行、无变化不记", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Old Name" },
      db,
    );

    await updateTeamProject(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        name: "New Name",
        status: "in_progress",
      },
      db,
    );
    const afterSave = (await listActivityRows(db, project.id)).filter(
      (row) => row.type !== "created",
    );
    expect(afterSave).toHaveLength(2);
    const nameRow = afterSave.find((row) => row.type === "name");
    const statusRow = afterSave.find((row) => row.type === "status");
    expect(nameRow?.payload).toEqual({
      kind: "scalar",
      from: "Old Name",
      to: "New Name",
    });
    expect(statusRow?.payload).toEqual({
      kind: "scalar",
      from: "backlog",
      to: "in_progress",
    });

    await updateTeamProject(
      { teamId: team.id, projectId: project.id, actorId: owner.id, name: "New Name" },
      db,
    );
    const afterNoop = (await listActivityRows(db, project.id)).filter(
      (row) => row.type !== "created",
    );
    expect(afterNoop).toHaveLength(2);
  });

  it("updateTeamProject 的 lead / members / tags 落快照行", async () => {
    const { owner, team } = await setupTeam(db);
    const memberA = await createUser(db, "member-a");
    const memberB = await createUser(db, "member-b");
    await addTeamMember(db, team.id, memberA.id, "member");
    await addTeamMember(db, team.id, memberB.id, "member");
    const tag = await createTag(
      {
        teamId: team.id,
        actorId: owner.id,
        name: "ActTag",
        color: TAG_COLORS[0],
        type: "project",
      },
      db,
    );
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Snap Project" },
      db,
    );

    await updateTeamProject(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        leadId: memberA.id,
        memberIds: [memberA.id, memberB.id],
      },
      db,
    );
    const rows = await listActivityRows(db, project.id);
    const leadRow = rows.find((row) => row.type === "lead");
    const membersRow = rows.find((row) => row.type === "members");
    expect(leadRow?.payload).toEqual({
      kind: "scalar",
      from: null,
      to: "member-a",
    });
    expect(membersRow?.payload).toEqual({
      kind: "refs",
      from: [],
      to: [
        { id: memberA.id, name: "member-a" },
        { id: memberB.id, name: "member-b" },
      ],
    });

    await updateTeamProject(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        tagIds: [tag.id],
      },
      db,
    );
    const afterTags = await listActivityRows(db, project.id);
    const tagsRow = afterTags.find((row) => row.type === "tags");
    expect(tagsRow?.payload).toEqual({
      kind: "refs",
      from: [],
      to: [{ id: tag.id, name: "ActTag" }],
    });
  });

  it("updateTeamProjectStatus 状态没变不记，变了记一条", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Status Project" },
      db,
    );

    await updateTeamProjectStatus(
      { teamId: team.id, projectId: project.id, actorId: owner.id, status: "backlog" },
      db,
    );
    expect(await listActivityRows(db, project.id)).toHaveLength(1);

    await updateTeamProjectStatus(
      { teamId: team.id, projectId: project.id, actorId: owner.id, status: "planned" },
      db,
    );
    const rows = await listActivityRows(db, project.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.type === "status")?.payload).toEqual({
      kind: "scalar",
      from: "backlog",
      to: "planned",
    });
  });

  it("里程碑 add / update / delete 各落对应事件", async () => {
    const { owner, team } = await setupTeam(db);
    const project = await createTeamProject(
      { teamId: team.id, actorId: owner.id, name: "Ms Project" },
      db,
    );

    const milestone = await addTeamProjectMilestone(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        name: "MS-1",
        dueDate: "2026-12-01",
      },
      db,
    );
    let rows = await listActivityRows(db, project.id);
    expect(
      rows.find((row) => row.type === "milestone_added")?.payload,
    ).toEqual({ kind: "milestone_added", name: "MS-1", dueDate: "2026-12-01" });

    await updateTeamProjectMilestone(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        milestoneId: milestone.id,
        dueDate: "2026-12-15",
      },
      db,
    );
    rows = await listActivityRows(db, project.id);
    expect(
      rows.find((row) => row.type === "milestone_updated")?.payload,
    ).toEqual({
      kind: "milestone_updated",
      name: "MS-1",
      field: "dueDate",
      from: "2026-12-01",
      to: "2026-12-15",
    });

    await deleteTeamProjectMilestone(
      {
        teamId: team.id,
        projectId: project.id,
        actorId: owner.id,
        milestoneId: milestone.id,
      },
      db,
    );
    rows = await listActivityRows(db, project.id);
    expect(
      rows.find((row) => row.type === "milestone_removed")?.payload,
    ).toEqual({ kind: "milestone_removed", name: "MS-1" });
  });

  it("createPersonalProject 落 created 事件", async () => {
    const owner = await createUser(db, "p-act-owner");
    const project = await createPersonalProject(
      owner.id,
      { name: "Personal Act" },
      db,
    );

    const rows = await listActivityRows(db, project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "created",
      actorId: owner.id,
      payload: null,
    });
  });

  it("updatePersonalProject 多字段一次保存拆多行、无变化不记", async () => {
    const owner = await createUser(db, "p-act-owner2");
    const project = await createPersonalProject(
      owner.id,
      { name: "Old P Name" },
      db,
    );

    await updatePersonalProject(
      owner.id,
      project.id,
      { name: "New P Name", status: "in_progress" },
      db,
    );
    let rows = (await listActivityRows(db, project.id)).filter(
      (row) => row.type !== "created",
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.type === "name")?.payload).toEqual({
      kind: "scalar",
      from: "Old P Name",
      to: "New P Name",
    });
    expect(rows.find((row) => row.type === "status")?.payload).toEqual({
      kind: "scalar",
      from: "backlog",
      to: "in_progress",
    });

    await updatePersonalProject(owner.id, project.id, { name: "New P Name" }, db);
    rows = (await listActivityRows(db, project.id)).filter(
      (row) => row.type !== "created",
    );
    expect(rows).toHaveLength(2);
  });

  it("updatePersonalProject 仅打标也落 tags 快照行", async () => {
    const owner = await createUser(db, "p-act-owner3");
    const tag = await createTag(
      { ownerId: owner.id, name: "PTag", color: TAG_COLORS[0], type: "project" },
      db,
    );
    const project = await createPersonalProject(
      owner.id,
      { name: "Tagged P" },
      db,
    );

    await updatePersonalProject(owner.id, project.id, { tagIds: [tag.id] }, db);

    const rows = await listActivityRows(db, project.id);
    const tagsRow = rows.find((row) => row.type === "tags");
    expect(tagsRow?.payload).toEqual({
      kind: "refs",
      from: [],
      to: [{ id: tag.id, name: "PTag" }],
    });
  });

  it("updatePersonalProjectStatus 没变不记，变了记一条", async () => {
    const owner = await createUser(db, "p-act-owner4");
    const project = await createPersonalProject(
      owner.id,
      { name: "Status P" },
      db,
    );

    await updatePersonalProjectStatus(owner.id, project.id, "backlog", db);
    expect(await listActivityRows(db, project.id)).toHaveLength(1);

    await updatePersonalProjectStatus(owner.id, project.id, "planned", db);
    const rows = await listActivityRows(db, project.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.type === "status")?.payload).toEqual({
      kind: "scalar",
      from: "backlog",
      to: "planned",
    });
  });

  it("个人里程碑 add / update / delete 各落对应事件", async () => {
    const owner = await createUser(db, "p-act-owner5");
    const project = await createPersonalProject(
      owner.id,
      { name: "Ms P" },
      db,
    );

    const milestone = await addPersonalProjectMilestone(
      owner.id,
      project.id,
      { name: "P-MS", dueDate: "2026-12-01" },
      db,
    );
    let rows = await listActivityRows(db, project.id);
    expect(
      rows.find((row) => row.type === "milestone_added")?.payload,
    ).toEqual({ kind: "milestone_added", name: "P-MS", dueDate: "2026-12-01" });

    await updatePersonalProjectMilestone(
      owner.id,
      project.id,
      milestone.id,
      { dueDate: "2026-12-20" },
      db,
    );
    rows = await listActivityRows(db, project.id);
    expect(
      rows.find((row) => row.type === "milestone_updated")?.payload,
    ).toEqual({
      kind: "milestone_updated",
      name: "P-MS",
      field: "dueDate",
      from: "2026-12-01",
      to: "2026-12-20",
    });

    await deletePersonalProjectMilestone(owner.id, project.id, milestone.id, db);
    rows = await listActivityRows(db, project.id);
    expect(
      rows.find((row) => row.type === "milestone_removed")?.payload,
    ).toEqual({ kind: "milestone_removed", name: "P-MS" });
  });

  it("listProjectTimeline：根评论带 replies 升序，回复不占顶层，reply-to-reply 归根", async () => {
    const user = await createUser(db, "thread-owner");
    const project = await createPersonalProjectRow(db, user.id, "thread-project");

    await db.insert(projectActivities).values({
      projectId: project.id,
      actorId: user.id,
      type: "created",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const [root] = await db
      .insert(projectComments)
      .values({
        projectId: project.id,
        authorId: user.id,
        content: "root-c",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      })
      .returning();
    await db.insert(projectComments).values([
      {
        projectId: project.id,
        authorId: user.id,
        content: "reply-1",
        parentId: root!.id,
        createdAt: new Date("2026-01-03T00:00:00Z"),
      },
      {
        projectId: project.id,
        authorId: user.id,
        content: "reply-2",
        parentId: root!.id,
        createdAt: new Date("2026-01-04T00:00:00Z"),
      },
    ]);

    const items = await listProjectTimeline(project.id, {}, db);

    // 顶层只有根评论 + 动态；回复全部挂在根下且按时间升序。
    const topLevelComments = items.filter((item) => item.kind === "comment");
    expect(topLevelComments).toHaveLength(1);
    const rootItem = topLevelComments[0] as Extract<
      (typeof items)[number],
      { kind: "comment" }
    >;
    expect(rootItem.content).toBe("root-c");
    expect(rootItem.replies.map((reply) => reply.content)).toEqual([
      "reply-1",
      "reply-2",
    ]);
    expect(items[0]?.kind).toBe("comment"); // 根评论比动态新，排最前
  });
});
