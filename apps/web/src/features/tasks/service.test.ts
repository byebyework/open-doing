import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { NotificationType } from "@open-doing/types";

import { createTeamProject } from "@/features/projects/service";
import { createTeam } from "@/features/teams/service";
import { DomainError } from "@/lib/domain-error";
import { generateUid } from "@/lib/uid";
import type { DbClient } from "@/server/db/client";
import {
  comments,
  notifications,
  subtasks,
  tasks,
  teamMemberships,
  users,
} from "@/server/db/schema";
import { closeTestDb, setupTestDb } from "@/server/db/testing";

import { TaskPermissionError } from "./permissions";
import {
  addTeamComment,
  addTeamSubtask,
  createTeamTask,
  deleteTeamComment,
  deleteTeamTask,
  getTeamTaskDetail,
  listTeamProjectTasks,
  removeTeamSubtask,
  toggleTeamSubtask,
  updateTeamTask,
} from "./service";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[tasks/service.test] 未设置 TEST_DATABASE_URL，数据库用例已跳过。先运行 `docker compose up -d`，再设置 TEST_DATABASE_URL 执行 `pnpm test`。",
  );
}

/** 直插用户，避免每个用例都走 argon2 哈希。 */
async function createUser(
  db: DbClient,
  username: string,
): Promise<{ id: string; username: string }> {
  const [row] = await db
    .insert(users)
    .values({ uid: generateUid(), username, passwordHash: "test-hash" })
    .returning({ id: users.id, username: users.username });
  return row!;
}

/** 同一用例内多次建团队时用户名需唯一，用递增序号兜底。 */
let sequence = 0;

function uniqueName(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

interface TeamFixture {
  owner: { id: string; username: string };
  team: { id: string; slug: string };
  project: { id: string; slug: string };
}

/** 建团队 + 一个团队项目（owner 由 createTeam 自动写入成员关系）。 */
async function setupTeamWithProject(db: DbClient): Promise<TeamFixture> {
  const owner = await createUser(db, uniqueName("owner"));
  const team = await createTeam({ name: uniqueName("Team") }, owner.id, db);
  const project = await createTeamProject(
    { teamId: team.id, actorId: owner.id, name: uniqueName("Project") },
    db,
  );
  return { owner, team, project };
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

/** 统计某任务的某类通知条数。 */
async function countNotifications(
  db: DbClient,
  taskId: string,
  type: NotificationType,
): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.taskId, taskId), eq(notifications.type, type)));
  return rows.length;
}

describe.skipIf(!hasTestDatabase)("团队任务 service", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("创建任务", () => {
    it("member 可创建：spaceType 为 team、默认指派自己、字段已清洗", async () => {
      const { team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");

      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: member.id,
          title: "  写周报  ",
          description: "  本周进展  ",
          dueDate: "2026-10-30",
        },
        db,
      );

      expect(task).toMatchObject({
        projectId: project.id,
        spaceType: "team",
        title: "写周报",
        description: "本周进展",
        status: "todo",
        assigneeId: member.id,
        dueDate: "2026-10-30",
      });
      expect(await countNotifications(db, task.id, "task_assigned")).toBe(0);
    });

    it("指派他人：落库并给责任人发 task_assigned（字段完整）", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");

      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "设计评审",
          assigneeId: member.id,
        },
        db,
      );

      expect(task.assigneeId).toBe(member.id);

      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.taskId, task.id));

      expect(row).toMatchObject({
        userId: member.id,
        type: "task_assigned",
        teamId: team.id,
        projectId: project.id,
        taskId: task.id,
        actorId: owner.id,
        read: false,
      });
    });

    it("指派非团队成员：按字段 assigneeId 拒绝", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const outsider = await createUser(db, uniqueName("outsider"));

      await expect(
        createTeamTask(
          {
            teamId: team.id,
            projectId: project.id,
            actorId: owner.id,
            title: "越权指派",
            assigneeId: outsider.id,
          },
          db,
        ),
      ).rejects.toMatchObject({ name: "DomainError", field: "assigneeId" });
    });

    it("指派者就是自己时不发通知", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);

      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "自派任务",
          assigneeId: owner.id,
        },
        db,
      );

      expect(await countNotifications(db, task.id, "task_assigned")).toBe(0);
    });

    it("非成员不能建任务", async () => {
      const { team, project } = await setupTeamWithProject(db);
      const outsider = await createUser(db, uniqueName("outsider"));

      await expect(
        createTeamTask(
          { teamId: team.id, projectId: project.id, actorId: outsider.id, title: "外部任务" },
          db,
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe("编辑与改派", () => {
    it("member 改自己负责的任务成功", async () => {
      const { team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: member.id, title: "旧标题" },
        db,
      );

      const updated = await updateTeamTask(
        { teamId: team.id, taskId: task.id, actorId: member.id, title: "新标题", status: "in_progress" },
        db,
      );

      expect(updated).toMatchObject({ title: "新标题", status: "in_progress" });
    });

    it("member 改他人任务被拒绝", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "owner 的任务", assigneeId: owner.id },
        db,
      );

      await expect(
        updateTeamTask({ teamId: team.id, taskId: task.id, actorId: member.id, title: "篡改" }, db),
      ).rejects.toBeInstanceOf(TaskPermissionError);
    });

    it("owner 改他人任务：成功且原责任人收到 task_changed_by_admin", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "待办", assigneeId: member.id },
        db,
      );

      await updateTeamTask(
        { teamId: team.id, taskId: task.id, actorId: owner.id, title: "已调整", dueDate: "2026-11-01" },
        db,
      );

      const [row] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.taskId, task.id),
            eq(notifications.type, "task_changed_by_admin"),
          ),
        );

      expect(row).toMatchObject({ userId: member.id, actorId: owner.id });
    });

    it("owner 改自己负责的任务不产生 task_changed_by_admin", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "自己的" },
        db,
      );

      await updateTeamTask({ teamId: team.id, taskId: task.id, actorId: owner.id, title: "改过" }, db);

      expect(await countNotifications(db, task.id, "task_changed_by_admin")).toBe(0);
    });

    it("owner 改派：新责任人收到 task_assigned", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "改派", assigneeId: owner.id },
        db,
      );

      const updated = await updateTeamTask(
        { teamId: team.id, taskId: task.id, actorId: owner.id, assigneeId: member.id },
        db,
      );

      expect(updated.assigneeId).toBe(member.id);

      const [row] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.taskId, task.id),
            eq(notifications.type, "task_assigned"),
          ),
        );

      expect(row).toMatchObject({ userId: member.id, actorId: owner.id });
    });

    it("member 改派自己的任务成功并通知新责任人", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      const teammate = await createUser(db, uniqueName("teammate"));
      await addMember(db, team.id, member.id, "member");
      await addMember(db, team.id, teammate.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: member.id, title: "转交" },
        db,
      );

      const updated = await updateTeamTask(
        { teamId: team.id, taskId: task.id, actorId: member.id, assigneeId: teammate.id },
        db,
      );

      expect(updated.assigneeId).toBe(teammate.id);
      expect(await countNotifications(db, task.id, "task_assigned")).toBe(1);
      expect(owner.id).toBeTruthy();
    });

    it("member 改派他人任务被拒绝", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "别人的", assigneeId: owner.id },
        db,
      );

      await expect(
        updateTeamTask(
          { teamId: team.id, taskId: task.id, actorId: member.id, assigneeId: member.id },
          db,
        ),
      ).rejects.toBeInstanceOf(TaskPermissionError);
    });

    it("改派给非成员：按字段 assigneeId 拒绝", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const outsider = await createUser(db, uniqueName("outsider"));
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );

      await expect(
        updateTeamTask(
          { teamId: team.id, taskId: task.id, actorId: owner.id, assigneeId: outsider.id },
          db,
        ),
      ).rejects.toMatchObject({ field: "assigneeId" });
    });
  });

  describe("评论", () => {
    it("评论他人任务通知责任人；评论自己的任务不通知", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "讨论", assigneeId: member.id },
        db,
      );

      await addTeamComment(
        { teamId: team.id, taskId: task.id, actorId: owner.id, content: "  进度如何？  " },
        db,
      );

      expect(await countNotifications(db, task.id, "task_commented")).toBe(1);

      await addTeamComment(
        { teamId: team.id, taskId: task.id, actorId: member.id, content: "已完成" },
        db,
      );

      expect(await countNotifications(db, task.id, "task_commented")).toBe(1);
    });

    it("幂等撞车：两名成员先后评论同一任务，评论两条、task_commented 一条", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const assignee = await createUser(db, uniqueName("assignee"));
      const first = await createUser(db, uniqueName("first"));
      const second = await createUser(db, uniqueName("second"));
      await addMember(db, team.id, assignee.id, "member");
      await addMember(db, team.id, first.id, "member");
      await addMember(db, team.id, second.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "多人评论", assigneeId: assignee.id },
        db,
      );

      await addTeamComment({ teamId: team.id, taskId: task.id, actorId: first.id, content: "一" }, db);
      await addTeamComment({ teamId: team.id, taskId: task.id, actorId: second.id, content: "二" }, db);

      const commentRows = await db.select().from(comments).where(eq(comments.taskId, task.id));
      expect(commentRows).toHaveLength(2);
      expect(await countNotifications(db, task.id, "task_commented")).toBe(1);
    });

    it("非成员不能评论", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const outsider = await createUser(db, uniqueName("outsider"));
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );

      await expect(
        addTeamComment({ teamId: team.id, taskId: task.id, actorId: outsider.id, content: "路过" }, db),
      ).rejects.toBeInstanceOf(DomainError);
    });

    it("只能删除自己的评论：删除他人的被拒绝，删除自己的成功", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        { teamId: team.id, taskId: task.id, actorId: member.id, content: "我的评论" },
        db,
      );

      await expect(
        deleteTeamComment(
          { teamId: team.id, taskId: task.id, actorId: owner.id, commentId: comment.id },
          db,
        ),
      ).rejects.toBeInstanceOf(DomainError);

      await deleteTeamComment(
        { teamId: team.id, taskId: task.id, actorId: member.id, commentId: comment.id },
        db,
      );
      expect(await db.select().from(comments).where(eq(comments.id, comment.id))).toHaveLength(0);
    });
  });

  describe("子任务", () => {
    it("member 不能在他人任务上加子任务", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务", assigneeId: owner.id },
        db,
      );

      await expect(
        addTeamSubtask({ teamId: team.id, taskId: task.id, actorId: member.id, title: "拆解" }, db),
      ).rejects.toBeInstanceOf(TaskPermissionError);
    });

    it("在自己的任务上加 / 勾 / 删子任务成功；勾选不改主任务状态与 updatedAt", async () => {
      const { team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: member.id, title: "任务" },
        db,
      );

      const subtask = await addTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: member.id, title: "第一步" },
        db,
      );
      expect(subtask).toMatchObject({ taskId: task.id, title: "第一步", completed: false });

      const toggled = await toggleTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: member.id, subtaskId: subtask.id, completed: true },
        db,
      );
      expect(toggled.completed).toBe(true);
      expect(toggled.completedAt).toBeTruthy();

      const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(taskRow!.status).toBe("todo");
      expect(taskRow!.updatedAt.toISOString()).toBe(task.updatedAt);

      await removeTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: member.id, subtaskId: subtask.id },
        db,
      );
      expect(await db.select().from(subtasks).where(eq(subtasks.id, subtask.id))).toHaveLength(0);
    });
  });

  describe("可见性", () => {
    it("非成员列表为空、详情为 null", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const outsider = await createUser(db, uniqueName("outsider"));
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "私有" },
        db,
      );

      await expect(
        listTeamProjectTasks({ teamId: team.id, projectId: project.id, actorId: outsider.id }, db),
      ).resolves.toEqual([]);
      await expect(
        getTeamTaskDetail({ teamId: team.id, taskId: task.id, actorId: outsider.id }, db),
      ).resolves.toBeNull();
    });

    it("个人任务不能被团队详情查到", async () => {
      const { owner, team } = await setupTeamWithProject(db);
      const [personalTask] = await db
        .insert(tasks)
        .values({
          spaceType: "personal",
          title: "个人任务",
          assigneeId: owner.id,
          createdById: owner.id,
        })
        .returning();

      await expect(
        getTeamTaskDetail({ teamId: team.id, taskId: personalTask!.id, actorId: owner.id }, db),
      ).resolves.toBeNull();
    });

    it("跨团队操作被拒绝", async () => {
      const first = await setupTeamWithProject(db);
      const second = await setupTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: first.team.id, projectId: first.project.id, actorId: first.owner.id, title: "跨团队" },
        db,
      );

      await expect(
        deleteTeamTask(
          { teamId: second.team.id, taskId: task.id, actorId: second.owner.id },
          db,
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });

    it("列表按创建时间升序并带子任务与责任人名", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const first = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "第一" },
        db,
      );
      await addTeamSubtask({ teamId: team.id, taskId: first.id, actorId: owner.id, title: "子" }, db);
      await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "第二" },
        db,
      );

      const rows = await listTeamProjectTasks(
        { teamId: team.id, projectId: project.id, actorId: owner.id },
        db,
      );

      expect(rows.map((row) => row.title)).toEqual(["第一", "第二"]);
      expect(rows[0]!.assigneeName).toBe(owner.username);
      expect(rows[0]!.subtasks).toHaveLength(1);
    });
  });

  describe("未指派任务", () => {
    it("直插 assignee_id=null：列表 assigneeName 为 null，member 不可编辑，owner 可改派", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");

      const [row] = await db
        .insert(tasks)
        .values({
          projectId: project.id,
          spaceType: "team",
          title: "孤儿任务",
          assigneeId: null,
          createdById: owner.id,
        })
        .returning();

      const rows = await listTeamProjectTasks(
        { teamId: team.id, projectId: project.id, actorId: owner.id },
        db,
      );
      expect(rows.find((item) => item.id === row!.id)!.assigneeName).toBeNull();

      await expect(
        updateTeamTask(
          { teamId: team.id, taskId: row!.id, actorId: member.id, title: "认领" },
          db,
        ),
      ).rejects.toBeInstanceOf(TaskPermissionError);

      const updated = await updateTeamTask(
        { teamId: team.id, taskId: row!.id, actorId: owner.id, assigneeId: member.id },
        db,
      );
      expect(updated.assigneeId).toBe(member.id);
    });
  });

  describe("详情", () => {
    it("组装责任人 / 项目 / 创建人 / 进度与评论作者名", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "详情", assigneeId: member.id },
        db,
      );
      const done = await addTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: owner.id, title: "已完成" },
        db,
      );
      await addTeamSubtask({ teamId: team.id, taskId: task.id, actorId: owner.id, title: "未完成" }, db);
      await toggleTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: owner.id, subtaskId: done.id, completed: true },
        db,
      );
      await addTeamComment({ teamId: team.id, taskId: task.id, actorId: owner.id, content: "评论" }, db);

      const detail = await getTeamTaskDetail(
        { teamId: team.id, taskId: task.id, actorId: member.id },
        db,
      );

      expect(detail).toMatchObject({
        id: task.id,
        spaceType: "team",
        assigneeName: member.username,
        creatorName: owner.username,
        subtasks: [
          expect.objectContaining({ title: "已完成", completed: true }),
          expect.objectContaining({ title: "未完成", completed: false }),
        ],
        comments: [expect.objectContaining({ content: "评论", authorName: owner.username })],
      });
      expect(detail!.projectName).toBeTruthy();
      expect(detail!.progress).toBe(0.5);
    });
  });
});
