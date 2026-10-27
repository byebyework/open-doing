import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { generateJoinCode } from "@/lib/join-code";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import { notifications, projects, tasks, teams, users } from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { runDueScan, shanghaiToday } from "./due-scan";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[notifications/due-scan.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 扫描的固定“今天”，所有 DB 用例显式注入，避免依赖真实时钟。 */
const TODAY = "2026-10-24";
const YESTERDAY = "2026-10-23";
const TOMORROW = "2026-10-25";
const DAY_AFTER_TOMORROW = "2026-10-26";

async function createUser(db: DbClient, username: string) {
  const uid = generateUid();
  const [row] = await db
    .insert(users)
    .values({ uid, username, passwordHash: "test-hash" })
    .returning();
  return row!;
}

/** 造数上下文：owner + assignee，一个团队项目与一个个人任务。 */
async function seed(db: DbClient) {
  const owner = await createUser(db, "owner");
  const assignee = await createUser(db, "assignee");

  const [team] = await db
    .insert(teams)
    .values({
      name: "增长突击队",
      slug: "growth-squad",
      ownerId: owner.id,
      joinCode: generateJoinCode(),
    })
    .returning();
  const [teamProject] = await db
    .insert(projects)
    .values({ teamId: team!.id, name: "官网改版", slug: "website-revamp" })
    .returning();

  return { owner, assignee, team: team!, teamProject: teamProject! };
}

/** 插入一条任务，默认是「未完成、团队项目、指派给 assignee」。 */
async function createTask(
  db: DbClient,
  input: {
    createdById: string;
    projectId?: string | null;
    spaceType?: "personal" | "team";
    title?: string;
    status?: "todo" | "in_progress" | "done";
    assigneeId?: string | null;
    dueDate?: string | null;
  },
) {
  const [row] = await db
    .insert(tasks)
    .values({
      projectId: input.projectId ?? null,
      spaceType: input.spaceType ?? "team",
      title: input.title ?? "任务",
      status: input.status ?? "todo",
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      createdById: input.createdById,
    })
    .returning();
  return row!;
}

async function listUserNotifications(db: DbClient, userId: string) {
  return db.select().from(notifications).where(eq(notifications.userId, userId));
}

describe.skipIf(!hasTestDatabase)("到期扫描 runDueScan", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("昨天到期未完成任务：给 assignee 产生 1 条 task_overdue，连跑两次仍只有 1 条", async () => {
    const { owner, assignee, team, teamProject } = await seed(db);
    const task = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: assignee.id,
      dueDate: YESTERDAY,
    });

    expect(await runDueScan(db, TODAY)).toEqual({ dueSoon: 0, overdue: 1 });

    const rows = await listUserNotifications(db, assignee.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: assignee.id,
      type: "task_overdue",
      taskId: task.id,
      teamId: team.id,
      projectId: teamProject.id,
      actorId: null,
      read: false,
    });

    // 幂等：部分唯一索引兜底，第二次扫描不新增行。
    expect(await runDueScan(db, TODAY)).toEqual({ dueSoon: 0, overdue: 0 });
    expect(await listUserNotifications(db, assignee.id)).toHaveLength(1);
  });

  it("今天 / 明天到期各产生 1 条 task_due_soon，后天到期不产生", async () => {
    const { owner, assignee, teamProject } = await seed(db);
    const dueToday = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: assignee.id,
      title: "今天到期",
      dueDate: TODAY,
    });
    const dueTomorrow = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: assignee.id,
      title: "明天到期",
      dueDate: TOMORROW,
    });
    const dueLater = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: assignee.id,
      title: "后天到期",
      dueDate: DAY_AFTER_TOMORROW,
    });

    expect(await runDueScan(db, TODAY)).toEqual({ dueSoon: 2, overdue: 0 });

    const rows = await listUserNotifications(db, assignee.id);
    expect(rows.map((row) => [row.taskId, row.type]).sort()).toEqual(
      [
        [dueToday.id, "task_due_soon"],
        [dueTomorrow.id, "task_due_soon"],
      ].sort(),
    );
    expect(rows.some((row) => row.taskId === dueLater.id)).toBe(false);
  });

  it("已完成任务与未指派任务都不产生通知，且不报错", async () => {
    const { owner, assignee, teamProject } = await seed(db);
    const doneTask = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: assignee.id,
      status: "done",
      title: "已完成的逾期任务",
      dueDate: YESTERDAY,
    });
    const unassignedTask = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: null,
      title: "未指派任务",
      dueDate: YESTERDAY,
    });

    await expect(runDueScan(db, TODAY)).resolves.toEqual({ dueSoon: 0, overdue: 0 });
    expect(await listUserNotifications(db, assignee.id)).toHaveLength(0);

    const all = await db.select().from(notifications);
    expect(all.some((row) => row.taskId === doneTask.id)).toBe(false);
    expect(all.some((row) => row.taskId === unassignedTask.id)).toBe(false);
  });

  it("扫描后把截止日期改到过去再扫：新增 1 条 task_overdue，与已有 task_due_soon 并存", async () => {
    const { owner, assignee, teamProject } = await seed(db);
    const task = await createTask(db, {
      createdById: owner.id,
      projectId: teamProject.id,
      assigneeId: assignee.id,
      title: "临期后逾期",
      dueDate: TODAY,
    });

    expect(await runDueScan(db, TODAY)).toEqual({ dueSoon: 1, overdue: 0 });

    await db.update(tasks).set({ dueDate: YESTERDAY }).where(eq(tasks.id, task.id));

    // 新的扫描命中 task_overdue；已有的 task_due_soon 不会因扫描而删除。
    expect(await runDueScan(db, TODAY)).toEqual({ dueSoon: 0, overdue: 1 });

    const rows = await listUserNotifications(db, assignee.id);
    expect(rows.map((row) => row.type).sort()).toEqual(["task_due_soon", "task_overdue"]);
    expect(rows.every((row) => row.taskId === task.id)).toBe(true);
  });

  it("个人任务同样被扫描并通知 assignee（teamId / projectId 为 null）", async () => {
    const { owner, assignee } = await seed(db);
    const personalTask = await createTask(db, {
      createdById: owner.id,
      spaceType: "personal",
      title: "写周报",
      assigneeId: assignee.id,
      dueDate: YESTERDAY,
    });

    expect(await runDueScan(db, TODAY)).toEqual({ dueSoon: 0, overdue: 1 });

    const rows = await listUserNotifications(db, assignee.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "task_overdue",
      taskId: personalTask.id,
      teamId: null,
      projectId: null,
      actorId: null,
    });
  });
});

describe("shanghaiToday", () => {
  it("按 Asia/Shanghai 时区换算：UTC 17:00 已跨到次日", () => {
    expect(shanghaiToday(new Date("2026-10-24T17:00:00Z"))).toBe("2026-10-25");
  });

  it("上海当日白天仍是同一天", () => {
    expect(shanghaiToday(new Date("2026-10-24T02:00:00Z"))).toBe("2026-10-24");
  });
});
