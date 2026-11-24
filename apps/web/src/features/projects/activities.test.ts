import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  projectActivities,
  projectComments,
  projects,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

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
});
