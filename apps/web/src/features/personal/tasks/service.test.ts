import type { TaskStatus } from "@open-doing/types";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPersonalProject } from "@/features/personal/projects/service";
import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { comments, subtasks, tasks, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import {
  addPersonalComment,
  addPersonalSubtask,
  createPersonalTask,
  deletePersonalComment,
  deletePersonalTask,
  getPersonalTaskDetail,
  listPersonalProjectTasks,
  removePersonalSubtask,
  togglePersonalSubtask,
  updatePersonalTask,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[personal/tasks/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL=postgres://open-doing:open-doing@localhost:5433/open_doing_test 执行 `pnpm test`。",
  );
}

describe.skipIf(!hasTestDatabase)("个人任务 / 子任务 / 评论 service", () => {
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

  it("创建任务：默认字段齐全，assignee=创建人且 spaceType='personal'", async () => {
    const userId = await createUser();
    const project = await createPersonalProject(userId, { name: "阅读" }, db);

    const task = await createPersonalTask(
      userId,
      {
        title: "  读完《项目管理实战》  ",
        description: "第 4–6 章",
        dueDate: "2026-11-01",
        projectId: project.id,
      },
      db,
    );

    expect(task).toMatchObject({
      projectId: project.id,
      spaceType: "personal",
      title: "读完《项目管理实战》",
      description: "第 4–6 章",
      status: "todo",
      assigneeId: userId,
      dueDate: "2026-11-01",
    });
    expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(task.updatedAt))).toBe(false);

    const [row] = await db.select().from(tasks);
    expect(row).toMatchObject({
      projectId: project.id,
      spaceType: "personal",
      assigneeId: userId,
      createdById: userId,
      status: "todo",
      dueDate: "2026-11-01",
    });

    const loose = await createPersonalTask(userId, { title: "零散任务" }, db);
    expect(loose).toMatchObject({
      projectId: null,
      spaceType: "personal",
      status: "todo",
      assigneeId: userId,
    });
    expect(loose.description).toBeUndefined();
    expect(loose.dueDate).toBeUndefined();
  });

  it("创建到他人项目：抛出 DomainError 且不落库", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const project = await createPersonalProject(owner, { name: "Mine" }, db);

    await expect(
      createPersonalTask(
        other,
        { title: "偷建任务", projectId: project.id },
        db,
      ),
    ).rejects.toMatchObject({ field: "projectId" });

    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("归属断言：他人读详情为 null，更新 / 删除 / 子任务 / 评论均抛 DomainError", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const task = await createPersonalTask(owner, { title: "只属于我" }, db);

    await expect(getPersonalTaskDetail(other, task.id, db)).resolves.toBeNull();
    // 非 UUID 的 taskId 不应触发数据库错误，同样按「不存在」处理。
    await expect(
      getPersonalTaskDetail(other, "not-a-uuid", db),
    ).resolves.toBeNull();

    await expect(
      updatePersonalTask(other, task.id, { title: "Hijacked" }, db),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      deletePersonalTask(other, task.id, db),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      addPersonalSubtask(other, task.id, "偷加子任务", db),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      addPersonalComment(other, task.id, "偷加评论", db),
    ).rejects.toBeInstanceOf(DomainError);

    expect(await db.select().from(tasks)).toHaveLength(1);
    expect(await db.select().from(subtasks)).toHaveLength(0);
    expect(await db.select().from(comments)).toHaveLength(0);
  });

  it("切换子任务：只改 completed / completedAt，主任务 status 与 updatedAt 不变", async () => {
    const userId = await createUser();
    const task = await createPersonalTask(userId, { title: "状态不动" }, db);
    await updatePersonalTask(userId, task.id, { status: "in_progress" }, db);

    const subtask = await addPersonalSubtask(userId, task.id, "子任务", db);

    const [beforeToggle] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));

    const completed = await togglePersonalSubtask(
      userId,
      task.id,
      subtask.id,
      true,
      db,
    );
    expect(completed.completed).toBe(true);
    expect(completed.completedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(completed.completedAt!))).toBe(false);

    const [afterToggle] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(afterToggle!.status).toBe("in_progress");
    expect(afterToggle!.updatedAt.getTime()).toBe(
      beforeToggle!.updatedAt.getTime(),
    );

    const reopened = await togglePersonalSubtask(
      userId,
      task.id,
      subtask.id,
      false,
      db,
    );
    expect(reopened.completed).toBe(false);
    expect(reopened.completedAt).toBeUndefined();

    const [storedSubtask] = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.id, subtask.id));
    expect(storedSubtask!.completed).toBe(false);
    expect(storedSubtask!.completedAt).toBeNull();
  });

  it("详情组装：task 字段 + 子任务 + 评论 authorName + projectName + progress(3/5)", async () => {
    const owner = await createUser("alice");
    const project = await createPersonalProject(owner, { name: "读书" }, db);
    const task = await createPersonalTask(
      owner,
      {
        title: "读一章",
        description: "第一章",
        dueDate: "2026-11-01",
        projectId: project.id,
      },
      db,
    );

    const createdSubtasks = [];
    for (let index = 0; index < 5; index += 1) {
      createdSubtasks.push(
        await addPersonalSubtask(owner, task.id, `子任务 ${index + 1}`, db),
      );
    }
    for (const subtask of createdSubtasks.slice(0, 3)) {
      await togglePersonalSubtask(owner, task.id, subtask.id, true, db);
    }

    const comment = await addPersonalComment(
      owner,
      task.id,
      "  记录一下  ",
      db,
    );

    const detail = await getPersonalTaskDetail(owner, task.id, db);
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      id: task.id,
      projectId: project.id,
      spaceType: "personal",
      title: "读一章",
      description: "第一章",
      status: "todo",
      assigneeId: owner,
      assigneeName: "alice",
      dueDate: "2026-11-01",
      projectName: "读书",
      subtasks: expect.arrayContaining([
        expect.objectContaining({ id: createdSubtasks[0]!.id, completed: true }),
      ]),
      comments: [
        {
          id: comment.id,
          taskId: task.id,
          authorId: owner,
          authorName: "alice",
          content: "记录一下",
        },
      ],
    });
    expect(detail!.subtasks).toHaveLength(5);
    expect(detail!.subtasks.filter((item) => item.completed)).toHaveLength(3);
    expect(detail!.progress).toBeCloseTo(0.6, 10);
    expect(Number.isNaN(Date.parse(detail!.comments[0]!.createdAt))).toBe(
      false,
    );
  });

  it("详情：无子任务时 progress 按状态计算，无项目时 projectName 为 null", async () => {
    const userId = await createUser();
    const task = await createPersonalTask(userId, { title: "散任务" }, db);

    const todoDetail = await getPersonalTaskDetail(userId, task.id, db);
    expect(todoDetail!.projectName).toBeNull();
    expect(todoDetail!.progress).toBe(0);

    await updatePersonalTask(userId, task.id, { status: "in_progress" }, db);
    const inProgressDetail = await getPersonalTaskDetail(userId, task.id, db);
    expect(inProgressDetail!.progress).toBe(0.5);
  });

  it("更新任务：只改传入字段、清空描述/截止日期、刷新 updatedAt", async () => {
    const userId = await createUser();
    const task = await createPersonalTask(
      userId,
      { title: "旧标题", description: "旧描述", dueDate: "2026-10-30" },
      db,
    );

    await db
      .update(tasks)
      .set({ updatedAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(tasks.id, task.id));

    const updated = await updatePersonalTask(
      userId,
      task.id,
      {
        title: "新标题",
        description: "新描述",
        dueDate: "2026-12-31",
        status: "done",
      },
      db,
    );

    expect(updated).toMatchObject({
      id: task.id,
      title: "新标题",
      description: "新描述",
      dueDate: "2026-12-31",
      status: "done",
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );

    const cleared = await updatePersonalTask(
      userId,
      task.id,
      { description: "   ", dueDate: null },
      db,
    );
    expect(cleared.description).toBeUndefined();
    expect(cleared.dueDate).toBeUndefined();
  });

  it("评论：添加后可按作者删除，非作者删除抛 DomainError", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const task = await createPersonalTask(owner, { title: "备注任务" }, db);

    const comment = await addPersonalComment(
      owner,
      task.id,
      "  第一条备注  ",
      db,
    );
    expect(comment).toMatchObject({
      taskId: task.id,
      authorId: owner,
      content: "第一条备注",
    });

    // 防御性用例：即便库里出现他人评论，本人也不可删除。
    const [foreign] = await db
      .insert(comments)
      .values({ taskId: task.id, authorId: other, content: "他人评论" })
      .returning({ id: comments.id });

    await expect(
      deletePersonalComment(owner, task.id, foreign!.id, db),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await db.select().from(comments)).toHaveLength(2);

    await deletePersonalComment(owner, task.id, comment.id, db);
    expect((await db.select().from(comments)).map((row) => row.id)).toEqual([
      foreign!.id,
    ]);
  });

  it("删除任务：子任务与评论级联消失", async () => {
    const userId = await createUser();
    const task = await createPersonalTask(userId, { title: "将被删除" }, db);

    await addPersonalSubtask(userId, task.id, "子任务一", db);
    await addPersonalSubtask(userId, task.id, "子任务二", db);
    await addPersonalComment(userId, task.id, "备注", db);

    await deletePersonalTask(userId, task.id, db);

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(subtasks)).toHaveLength(0);
    expect(await db.select().from(comments)).toHaveLength(0);
  });

  it("子任务：新增 / 删除；跨任务删除抛 DomainError", async () => {
    const userId = await createUser();
    const task = await createPersonalTask(userId, { title: "任务 A" }, db);
    const otherTask = await createPersonalTask(userId, { title: "任务 B" }, db);

    const subtask = await addPersonalSubtask(userId, task.id, "可删", db);
    await db.insert(subtasks).values({ taskId: otherTask.id, title: "另一个" });

    const [otherSubtask] = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, otherTask.id));

    await expect(
      removePersonalSubtask(userId, task.id, otherSubtask!.id, db),
    ).rejects.toBeInstanceOf(DomainError);

    await removePersonalSubtask(userId, task.id, subtask.id, db);
    expect((await db.select().from(subtasks)).map((row) => row.id)).toEqual([
      otherSubtask!.id,
    ]);
  });

  it("列表：他人项目为空；本人项目按 createdAt 升序并嵌套子任务", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const project = await createPersonalProject(owner, { name: "本人项目" }, db);
    const otherProject = await createPersonalProject(
      other,
      { name: "他人项目" },
      db,
    );

    const later = await createPersonalTask(
      owner,
      { title: "Later", projectId: project.id },
      db,
    );
    const earlier = await createPersonalTask(
      owner,
      { title: "Earlier", projectId: project.id },
      db,
    );
    await createPersonalTask(
      other,
      { title: "他人任务", projectId: otherProject.id },
      db,
    );

    await db
      .update(tasks)
      .set({ createdAt: new Date("2026-10-01T00:00:00.000Z") })
      .where(eq(tasks.id, earlier.id));
    await db
      .update(tasks)
      .set({ createdAt: new Date("2026-10-02T00:00:00.000Z") })
      .where(eq(tasks.id, later.id));

    const subtask = await addPersonalSubtask(
      owner,
      earlier.id,
      "第一个子任务",
      db,
    );

    const ownList = await listPersonalProjectTasks(owner, project.id, db);
    expect(ownList.map((task) => task.title)).toEqual(["Earlier", "Later"]);
    expect(ownList[0]!.subtasks.map((item) => item.id)).toEqual([subtask.id]);
    expect(ownList[1]!.subtasks).toEqual([]);

    await expect(
      listPersonalProjectTasks(owner, otherProject.id, db),
    ).resolves.toEqual([]);
    await expect(
      listPersonalProjectTasks(owner, "not-a-uuid", db),
    ).resolves.toEqual([]);
  });

  it("校验：标题 1–200 字、截止日期 YYYY-MM-DD、评论 1–2000 字、状态合法", async () => {
    const userId = await createUser();

    await expect(
      createPersonalTask(userId, { title: "   " }, db),
    ).rejects.toMatchObject({ field: "title" });
    await expect(
      createPersonalTask(userId, { title: "a".repeat(201) }, db),
    ).rejects.toMatchObject({ field: "title" });
    await expect(
      createPersonalTask(userId, { title: "合法", dueDate: "2026/11/01" }, db),
    ).rejects.toMatchObject({ field: "dueDate" });
    await expect(
      createPersonalTask(userId, { title: "合法", dueDate: "2026-02-31" }, db),
    ).rejects.toMatchObject({ field: "dueDate" });

    const task = await createPersonalTask(userId, { title: "合法" }, db);

    await expect(
      addPersonalComment(userId, task.id, "   ", db),
    ).rejects.toMatchObject({ field: "content" });
    await expect(
      addPersonalComment(userId, task.id, "b".repeat(2001), db),
    ).rejects.toMatchObject({ field: "content" });
    await expect(
      addPersonalSubtask(userId, task.id, "   ", db),
    ).rejects.toMatchObject({ field: "title" });
    await expect(
      updatePersonalTask(
        userId,
        task.id,
        { status: "blocked" as TaskStatus },
        db,
      ),
    ).rejects.toMatchObject({ field: "status" });
  });
});
