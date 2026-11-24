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
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  listProjectTimeline,
  resolveTagRefs,
  resolveUserRefs,
} from "./activities";

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
});
