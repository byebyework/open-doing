import type { Project } from "@open-doing/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { comments, projects, subtasks, tasks, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  createPersonalProject,
  deletePersonalProject,
  getPersonalProjectBySlug,
  listPersonalProjects,
  updatePersonalProject,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[personal/projects/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("个人项目 service", () => {
  let db: DbClient;
  let userSeq = 0;

  beforeEach(async () => {
    db = await setupTestDb();
    userSeq = 0;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function createUser(username = `user_${(userSeq += 1)}`) {
    const [row] = await db
      .insert(users)
      .values({ uid: generateUid(), username, passwordHash: "test-hash" })
      .returning({ id: users.id });
    return row!.id;
  }

  it("创建项目：返回映射后的 Project，slug 唯一且日期为 ISO 字符串", async () => {
    const userId = await createUser();
    const project = await createPersonalProject(
      userId,
      { name: "Alpha Project", description: "第一阶段的安排" },
      db,
    );

    expect(project).toMatchObject({
      teamId: null,
      ownerId: userId,
      name: "Alpha Project",
      slug: "alpha-project",
      description: "第一阶段的安排",
    });
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
    expect(await db.select().from(projects)).toHaveLength(1);
  });

  it("同名第二个项目：slug 自动追加 -2", async () => {
    const userId = await createUser();

    const first = await createPersonalProject(userId, { name: "Alpha Project" }, db);
    const second = await createPersonalProject(userId, { name: "Alpha Project" }, db);

    expect(first.slug).toBe("alpha-project");
    expect(second.slug).toBe("alpha-project-2");

    const stored = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.ownerId, userId));
    expect(stored.map((row) => row.slug).sort()).toEqual([
      "alpha-project",
      "alpha-project-2",
    ]);
  });

  it("不同用户的同名项目互不占用 slug", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    const aliceProject = await createPersonalProject(alice, { name: "阅读" }, db);
    const bobProject = await createPersonalProject(bob, { name: "阅读" }, db);

    expect(aliceProject.slug).toBe("project");
    expect(bobProject.slug).toBe("project");
  });

  it("getPersonalProjectBySlug：仅本人可读，他人 / 不存在均返回 null", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const project = await createPersonalProject(owner, { name: "Personal Plan" }, db);

    await expect(
      getPersonalProjectBySlug(owner, project.slug, db),
    ).resolves.toEqual(project);
    await expect(
      getPersonalProjectBySlug(other, project.slug, db),
    ).resolves.toBeNull();
    await expect(
      getPersonalProjectBySlug(owner, "missing-slug", db),
    ).resolves.toBeNull();
  });

  it("更新项目：仅更新 name / description，slug 保持不变", async () => {
    const userId = await createUser();
    const created = await createPersonalProject(
      userId,
      { name: "Old Name", description: "旧描述" },
      db,
    );

    const updated = await updatePersonalProject(
      userId,
      created.id,
      { name: "New Name", description: "新描述" },
      db,
    );

    expect(updated).toMatchObject({
      id: created.id,
      name: "New Name",
      description: "新描述",
      slug: created.slug,
    });
  });

  it("更新 / 删除他人项目：抛出 DomainError", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const project = await createPersonalProject(owner, { name: "Mine" }, db);

    await expect(
      updatePersonalProject(other, project.id, { name: "Hijacked" }, db),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      deletePersonalProject(other, project.id, db),
    ).rejects.toBeInstanceOf(DomainError);

    // 归属断言失败时不能改动或删除原数据。
    expect(await db.select().from(projects)).toHaveLength(1);
  });

  it("删除项目：项目及其任务 / 子任务 / 评论级联消失", async () => {
    const userId = await createUser();
    const project = await createPersonalProject(userId, { name: "Cascade" }, db);

    const [task] = await db
      .insert(tasks)
      .values({
        projectId: project.id,
        spaceType: "personal",
        title: "项目内任务",
        status: "todo",
        assigneeId: userId,
        createdById: userId,
      })
      .returning({ id: tasks.id });

    await db.insert(subtasks).values({ taskId: task!.id, title: "子任务" });
    await db
      .insert(comments)
      .values({ taskId: task!.id, authorId: userId, content: "备注" });

    await deletePersonalProject(userId, project.id, db);

    expect(await db.select().from(projects)).toHaveLength(0);
    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(subtasks)).toHaveLength(0);
    expect(await db.select().from(comments)).toHaveLength(0);
  });

  it("中文项目名：创建成功并回落为 project slug", async () => {
    const userId = await createUser();

    const project = await createPersonalProject(
      userId,
      { name: "学习成长", description: "读书、课程与复盘" },
      db,
    );

    expect(project.name).toBe("学习成长");
    expect(project.slug).toBe("project");
  });

  it("列表：只返回本人项目，按 createdAt 升序", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");

    const later = await createPersonalProject(owner, { name: "Later" }, db);
    const earlier = await createPersonalProject(owner, { name: "Earlier" }, db);
    await createPersonalProject(other, { name: "Other" }, db);

    // 显式设定时间戳，避免同毫秒创建导致顺序不稳定。
    await db
      .update(projects)
      .set({ createdAt: new Date("2026-10-01T00:00:00.000Z") })
      .where(eq(projects.id, earlier.id));
    await db
      .update(projects)
      .set({ createdAt: new Date("2026-10-02T00:00:00.000Z") })
      .where(eq(projects.id, later.id));

    const list: Project[] = await listPersonalProjects(owner, db);

    expect(list.map((item) => item.name)).toEqual(["Earlier", "Later"]);
    expect(list.every((item) => item.ownerId === owner)).toBe(true);
  });

  it("校验：名称必填且不超过 50 字，描述不超过 500 字", async () => {
    const userId = await createUser();

    await expect(
      createPersonalProject(userId, { name: "   " }, db),
    ).rejects.toMatchObject({ field: "name" });
    await expect(
      createPersonalProject(userId, { name: "a".repeat(51) }, db),
    ).rejects.toMatchObject({ field: "name" });
    await expect(
      createPersonalProject(
        userId,
        { name: "Valid", description: "b".repeat(501) },
        db,
      ),
    ).rejects.toMatchObject({ field: "description" });
  });
});
