import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { NotificationType, VirtualMember } from "@open-doing/types";

import { createTeamProject } from "@/features/projects/service";
import { createTeam } from "@/features/teams/service";
import {
  createVirtualMember,
  removeVirtualMember,
} from "@/features/teams/virtual/service";
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

/** 直插用户，避免每个用例都走 better-auth 密码哈希；昵称与用户名区分，覆盖展示名规则。 */
async function createUser(
  db: DbClient,
  username: string,
): Promise<{ id: string; username: string; nickname: string }> {
  const id = crypto.randomUUID();
  const nickname = `nick-${username}`;
  await db.insert(users).values({
    id,
    uid: generateUid(),
    username,
    name: nickname,
    email: `${id}@test.local`,
    displayUsername: username,
  });
  return { id, username, nickname };
}

/** 同一用例内多次建团队时用户名需唯一，用递增序号兜底。 */
let sequence = 0;

function uniqueName(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

interface TeamFixture {
  owner: { id: string; username: string; nickname: string };
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

interface VirtualTeamFixture extends TeamFixture {
  virtualMember: VirtualMember;
}

/** 虚拟团队 + 团队项目 + 一名虚拟成员（owner 由 createTeam 自动写入成员关系）。 */
async function setupVirtualTeamWithProject(
  db: DbClient,
): Promise<VirtualTeamFixture> {
  const owner = await createUser(db, uniqueName("owner"));
  const team = await createTeam(
    { name: uniqueName("VirtualTeam"), kind: "virtual" },
    owner.id,
    db,
  );
  const project = await createTeamProject(
    { teamId: team.id, actorId: owner.id, name: uniqueName("Project") },
    db,
  );
  const virtualMember = await createVirtualMember(
    {
      teamId: team.id,
      actorId: owner.id,
      name: uniqueName("agent"),
      accentColor: "#7d2ae8",
    },
    db,
  );
  return { owner, team, project, virtualMember };
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
          startDate: "2026-10-28",
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
        startDate: "2026-10-28",
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

    it("优先级：创建可带三档，更新未传不改、非法值拒绝", async () => {
      const { team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");

      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: member.id,
          title: "带优先级",
          priority: "high",
        },
        db,
      );
      expect(task.priority).toBe("high");

      const lowered = await updateTeamTask(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: member.id,
          priority: "low",
        },
        db,
      );
      expect(lowered.priority).toBe("low");

      const untouched = await updateTeamTask(
        { teamId: team.id, taskId: task.id, actorId: member.id, title: "改名" },
        db,
      );
      expect(untouched.priority).toBe("low");

      await expect(
        updateTeamTask(
          {
            teamId: team.id,
            taskId: task.id,
            actorId: member.id,
            priority: "urgent" as never,
          },
          db,
        ),
      ).rejects.toMatchObject({ field: "priority" });
    });

    it("owner 原样保存（字段值未变）不产生 task_changed_by_admin，也不推进 updatedAt", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "待办",
          description: "原始描述",
          dueDate: "2026-11-01",
          assigneeId: member.id,
        },
        db,
      );

      // 编辑弹窗会原样回传全部字段：值都没变时不应算作「管理员改动」。
      const saved = await updateTeamTask(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          title: "待办",
          description: "原始描述",
          dueDate: "2026-11-01",
        },
        db,
      );

      expect(await countNotifications(db, task.id, "task_changed_by_admin")).toBe(0);
      expect(saved.updatedAt).toBe(task.updatedAt);
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

  describe("指派虚拟成员", () => {
    it("虚拟团队创建任务指派虚拟成员：assigneeVirtualId 落库、assigneeId 为 null、不发通知", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);

      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "agent 任务",
          assigneeVirtualId: virtualMember.id,
        },
        db,
      );

      expect(task).toMatchObject({
        assigneeId: null,
        assigneeVirtualId: virtualMember.id,
      });

      const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.assigneeId).toBeNull();
      expect(row!.assigneeVirtualId).toBe(virtualMember.id);
      expect(await countNotifications(db, task.id, "task_assigned")).toBe(0);
    });

    it("真实团队任务指派虚拟成员：按字段 assigneeId 拒绝（assigneeNotVirtualMember）", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const virtual = await setupVirtualTeamWithProject(db);

      await expect(
        createTeamTask(
          {
            teamId: team.id,
            projectId: project.id,
            actorId: owner.id,
            title: "真实团队任务",
            assigneeVirtualId: virtual.virtualMember.id,
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        field: "assigneeId",
        i18n: { key: "assigneeNotVirtualMember" },
      });
    });

    it("真人与虚拟成员同时指派：按字段 assigneeId 拒绝（assigneeConflict）", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);

      await expect(
        createTeamTask(
          {
            teamId: team.id,
            projectId: project.id,
            actorId: owner.id,
            title: "双指派",
            assigneeId: owner.id,
            assigneeVirtualId: virtualMember.id,
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        field: "assigneeId",
        i18n: { key: "assigneeConflict" },
      });
    });

    it("指派别的团队的虚拟成员：拒绝（assigneeNotVirtualMember）", async () => {
      const first = await setupVirtualTeamWithProject(db);
      const second = await setupVirtualTeamWithProject(db);

      await expect(
        createTeamTask(
          {
            teamId: second.team.id,
            projectId: second.project.id,
            actorId: second.owner.id,
            title: "跨团队虚拟指派",
            assigneeVirtualId: first.virtualMember.id,
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        field: "assigneeId",
        i18n: { key: "assigneeNotVirtualMember" },
      });
    });

    it("updateTeamTask 从真人改派到虚拟成员：互斥成立且不发通知", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "改派给 agent",
          assigneeId: owner.id,
        },
        db,
      );

      const updated = await updateTeamTask(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          assigneeVirtualId: virtualMember.id,
        },
        db,
      );

      expect(updated).toMatchObject({
        assigneeId: null,
        assigneeVirtualId: virtualMember.id,
      });

      const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.assigneeId).toBeNull();
      expect(row!.assigneeVirtualId).toBe(virtualMember.id);
      expect(await countNotifications(db, task.id, "task_assigned")).toBe(0);
    });

    it("列表与详情：assigneeName 回退到虚拟成员名，详情填充虚拟责任人字段", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "虚拟责任人",
          assigneeVirtualId: virtualMember.id,
        },
        db,
      );

      const rows = await listTeamProjectTasks(
        { teamId: team.id, projectId: project.id, actorId: owner.id },
        db,
      );
      expect(rows[0]!.assigneeName).toBe(virtualMember.name);
      expect(rows[0]!.assigneeRef).toMatchObject({
        type: "virtual",
        virtualMemberId: virtualMember.id,
        name: virtualMember.name,
        accentColor: "#7d2ae8",
      });

      const detail = await getTeamTaskDetail(
        { teamId: team.id, taskId: task.id, actorId: owner.id },
        db,
      );
      expect(detail).toMatchObject({
        assigneeId: null,
        assigneeName: virtualMember.name,
        assigneeVirtualId: virtualMember.id,
        assigneeVirtualName: virtualMember.name,
        assigneeAccentColor: "#7d2ae8",
        assigneeEmail: null,
      });
    });

    it("真人与虚拟成员同时作为 updateTeamTask 入参：拒绝（assigneeConflict）", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "任务",
          assigneeId: owner.id,
        },
        db,
      );

      await expect(
        updateTeamTask(
          {
            teamId: team.id,
            taskId: task.id,
            actorId: owner.id,
            assigneeId: owner.id,
            assigneeVirtualId: virtualMember.id,
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        field: "assigneeId",
        i18n: { key: "assigneeConflict" },
      });
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

  describe("虚拟作者评论", () => {
    it("① 虚拟作者评论落库：authorId 为 null、authorVirtualId 有值；详情返回虚拟成员名与头像色、不通知真人", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "agent 汇报",
          assigneeId: member.id,
        },
        db,
      );

      const comment = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "  进度 50%  ",
        },
        db,
      );

      expect(comment).toMatchObject({
        taskId: task.id,
        authorId: null,
        authorVirtualId: virtualMember.id,
        content: "进度 50%",
      });

      const [row] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, comment.id));
      expect(row!.authorId).toBeNull();
      expect(row!.authorVirtualId).toBe(virtualMember.id);

      // agent 链路（虚拟作者）不触发真人责任人通知。
      expect(await countNotifications(db, task.id, "task_commented")).toBe(0);

      const detail = await getTeamTaskDetail(
        { teamId: team.id, taskId: task.id, actorId: owner.id },
        db,
      );
      expect(detail!.comments).toEqual([
        expect.objectContaining({
          id: comment.id,
          authorId: null,
          authorVirtualId: virtualMember.id,
          authorName: virtualMember.name,
          authorAccentColor: "#7d2ae8",
        }),
      ]);
    });

    it("② owner 可删除虚拟作者评论（owner 管理权）", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "agent 评论",
        },
        db,
      );

      await deleteTeamComment(
        { teamId: team.id, taskId: task.id, actorId: owner.id, commentId: comment.id },
        db,
      );

      expect(
        await db.select().from(comments).where(eq(comments.id, comment.id)),
      ).toHaveLength(0);
    });

    it("③ owner 仍不能删除真人作者的评论（本人独占策略不变）", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        { teamId: team.id, taskId: task.id, actorId: member.id, content: "真人评论" },
        db,
      );

      await expect(
        deleteTeamComment(
          { teamId: team.id, taskId: task.id, actorId: owner.id, commentId: comment.id },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        i18n: { key: "commentNotFound" },
      });
      expect(
        await db.select().from(comments).where(eq(comments.id, comment.id)),
      ).toHaveLength(1);
    });

    it("④ member 不能删除虚拟作者评论（仅 owner/admin 可代管）", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "agent 评论",
        },
        db,
      );

      await expect(
        deleteTeamComment(
          { teamId: team.id, taskId: task.id, actorId: member.id, commentId: comment.id },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        i18n: { key: "commentNotFound" },
      });
      expect(
        await db.select().from(comments).where(eq(comments.id, comment.id)),
      ).toHaveLength(1);
    });

    it("⑤ 移除虚拟成员后：评论保留，详情 authorName / authorId / authorVirtualId 均为 null", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "历史 agent 评论",
        },
        db,
      );

      await removeVirtualMember(
        { teamId: team.id, virtualMemberId: virtualMember.id, actorId: owner.id },
        db,
      );

      expect(
        await db.select().from(comments).where(eq(comments.id, comment.id)),
      ).toHaveLength(1);

      const detail = await getTeamTaskDetail(
        { teamId: team.id, taskId: task.id, actorId: owner.id },
        db,
      );
      expect(detail!.comments).toEqual([
        expect.objectContaining({
          id: comment.id,
          authorId: null,
          authorVirtualId: null,
          authorName: null,
          authorAccentColor: null,
          content: "历史 agent 评论",
        }),
      ]);
    });

    it("⑥ 作者恰好一人：两列同时提供 / 皆空均拒绝；真实团队不接受虚拟作者", async () => {
      const virtual = await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        {
          teamId: virtual.team.id,
          projectId: virtual.project.id,
          actorId: virtual.owner.id,
          title: "任务",
        },
        db,
      );

      // 真人与虚拟作者同时提供（DB CHECK 会拒，service 先行给出领域错误）。
      const conflict = await addTeamComment(
        {
          teamId: virtual.team.id,
          taskId: task.id,
          actorId: virtual.owner.id,
          authorId: virtual.owner.id,
          authorVirtualId: virtual.virtualMember.id,
          content: "冲突",
        },
        db,
      ).catch((error: unknown) => error);
      expect(conflict).toBeInstanceOf(DomainError);
      expect((conflict as DomainError).field).toBeUndefined();
      expect((conflict as DomainError).i18n).toMatchObject({
        key: "commentVirtualAuthorInvalid",
      });

      // 两列皆空同样拒绝（创建时必须恰好一者）。
      await expect(
        addTeamComment(
          {
            teamId: virtual.team.id,
            taskId: task.id,
            actorId: virtual.owner.id,
            authorId: null,
            content: "无署名",
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        i18n: { key: "commentVirtualAuthorInvalid" },
      });

      // 真实团队不接受虚拟作者（即便虚拟成员属于另一个虚拟团队）。
      const real = await setupTeamWithProject(db);
      const realTask = await createTeamTask(
        { teamId: real.team.id, projectId: real.project.id, actorId: real.owner.id, title: "真人团队任务" },
        db,
      );

      await expect(
        addTeamComment(
          {
            teamId: real.team.id,
            taskId: realTask.id,
            actorId: real.owner.id,
            authorVirtualId: virtual.virtualMember.id,
            content: "越权署名",
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        i18n: { key: "commentVirtualAuthorInvalid" },
      });
      expect(
        await db.select().from(comments).where(eq(comments.taskId, realTask.id)),
      ).toHaveLength(0);
    });

    it("⑦ 署名不可伪造：显式 authorId 指向他人（≠ actorId）被拒绝", async () => {
      const { owner, team, project } = await setupVirtualTeamWithProject(db);
      const third = await createUser(db, uniqueName("third"));
      await addMember(db, team.id, third.id, "member");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );

      const error = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorId: third.id,
          content: "冒充署名",
        },
        db,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).i18n).toMatchObject({
        key: "commentVirtualAuthorInvalid",
      });
      expect(
        await db.select().from(comments).where(eq(comments.taskId, task.id)),
      ).toHaveLength(0);
    });

    it("⑧ admin（非 owner）可删除虚拟作者评论", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const admin = await createUser(db, uniqueName("admin"));
      await addMember(db, team.id, admin.id, "admin");
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "agent 评论",
        },
        db,
      );

      await deleteTeamComment(
        { teamId: team.id, taskId: task.id, actorId: admin.id, commentId: comment.id },
        db,
      );

      expect(
        await db.select().from(comments).where(eq(comments.id, comment.id)),
      ).toHaveLength(0);
    });

    it("⑨ 虚拟成员移除后的无署名评论：owner 可在虚拟团队代删", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );
      const comment = await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "历史 agent 评论",
        },
        db,
      );

      await removeVirtualMember(
        { teamId: team.id, virtualMemberId: virtualMember.id, actorId: owner.id },
        db,
      );

      // 两列皆空（无署名）后仍可被虚拟团队 owner 代管删除。
      await deleteTeamComment(
        { teamId: team.id, taskId: task.id, actorId: owner.id, commentId: comment.id },
        db,
      );
      expect(
        await db.select().from(comments).where(eq(comments.id, comment.id)),
      ).toHaveLength(0);
    });
  });

  describe("agent 活动通知", () => {
    it("agent 评论通知任务创建者 task_commented_by_agent，虚拟成员署名且只一条", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "agent 汇报",
          assigneeId: owner.id,
        },
        db,
      );

      await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "进度 50%",
        },
        db,
      );
      await addTeamComment(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          authorVirtualId: virtualMember.id,
          content: "进度 90%",
        },
        db,
      );

      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.taskId, task.id),
            eq(notifications.type, "task_commented_by_agent"),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.id,
        actorId: null,
        actorVirtualId: virtualMember.id,
      });
      // 真人评论通知（task_commented）仍不因 agent 评论触发。
      expect(await countNotifications(db, task.id, "task_commented")).toBe(0);
    });

    it("agent 改状态通知创建者 task_changed_by_agent；同状态重提交不发新通知", async () => {
      const { owner, team, project, virtualMember } =
        await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );

      await updateTeamTask(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          status: "done",
          actorVirtualId: virtualMember.id,
        },
        db,
      );

      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.taskId, task.id),
            eq(notifications.type, "task_changed_by_agent"),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.id,
        actorId: null,
        actorVirtualId: virtualMember.id,
      });

      const [before] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      await updateTeamTask(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          status: "done",
          actorVirtualId: virtualMember.id,
        },
        db,
      );
      const [after] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
      expect(
        await countNotifications(db, task.id, "task_changed_by_agent"),
      ).toBe(1);
    });

    it("actorVirtualId 必须是本任务团队的虚拟成员", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const other = await setupVirtualTeamWithProject(db);
      const task = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "任务" },
        db,
      );

      await expect(
        updateTeamTask(
          {
            teamId: team.id,
            taskId: task.id,
            actorId: owner.id,
            status: "done",
            actorVirtualId: other.virtualMember.id,
          },
          db,
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        i18n: { key: "commentVirtualAuthorInvalid" },
      });

      const [row] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(row!.status).toBe("todo");
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
      const personalTask = { id: crypto.randomUUID() };
      await db.insert(tasks).values({
        id: personalTask.id,
        spaceType: "personal",
        title: "个人任务",
        assigneeId: owner.id,
        createdById: owner.id,
      });

      await expect(
        getTeamTaskDetail({ teamId: team.id, taskId: personalTask.id, actorId: owner.id }, db),
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
      const second = await createTeamTask(
        { teamId: team.id, projectId: project.id, actorId: owner.id, title: "第二" },
        db,
      );

      // 显式错开创建时间，固定列表排序语义（避免同一时刻创建导致顺序不确定）。
      await db
        .update(tasks)
        .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
        .where(eq(tasks.id, first.id));
      await db
        .update(tasks)
        .set({ createdAt: new Date("2026-01-01T00:00:01Z") })
        .where(eq(tasks.id, second.id));

      const rows = await listTeamProjectTasks(
        { teamId: team.id, projectId: project.id, actorId: owner.id },
        db,
      );

      expect(rows.map((row) => row.title)).toEqual(["第一", "第二"]);
      expect(rows[0]!.assigneeName).toBe(owner.nickname);
      expect(rows[0]!.subtasks).toHaveLength(1);
    });
  });

  describe("未指派任务", () => {
    it("直插 assignee_id=null：列表 assigneeName 为 null，member 不可编辑，owner 可改派", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const member = await createUser(db, uniqueName("member"));
      await addMember(db, team.id, member.id, "member");

      const row = { id: crypto.randomUUID() };
      await db.insert(tasks).values({
        id: row.id,
        projectId: project.id,
        spaceType: "team",
        title: "孤儿任务",
        assigneeId: null,
        createdById: owner.id,
      });

      const rows = await listTeamProjectTasks(
        { teamId: team.id, projectId: project.id, actorId: owner.id },
        db,
      );
      expect(rows.find((item) => item.id === row.id)!.assigneeName).toBeNull();

      await expect(
        updateTeamTask(
          { teamId: team.id, taskId: row.id, actorId: member.id, title: "认领" },
          db,
        ),
      ).rejects.toBeInstanceOf(TaskPermissionError);

      const updated = await updateTeamTask(
        { teamId: team.id, taskId: row.id, actorId: owner.id, assigneeId: member.id },
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
      const pending = await addTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: owner.id, title: "未完成" },
        db,
      );
      // 显式错开创建时间，固定列表排序语义（避免同一时刻创建导致顺序不确定）。
      await db
        .update(subtasks)
        .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
        .where(eq(subtasks.id, done.id));
      await db
        .update(subtasks)
        .set({ createdAt: new Date("2026-01-01T00:00:01Z") })
        .where(eq(subtasks.id, pending.id));
      await toggleTeamSubtask(
        { teamId: team.id, taskId: task.id, actorId: owner.id, subtaskId: done.id, completed: true },
        db,
      );
      await addTeamComment({ teamId: team.id, taskId: task.id, actorId: owner.id, content: "评论" }, db);
      // 负责人信息处邮箱：详情读模型随责任人一并下发。
      await db
        .update(users)
        .set({ email: "member@example.com" })
        .where(eq(users.id, member.id));

      const detail = await getTeamTaskDetail(
        { teamId: team.id, taskId: task.id, actorId: member.id },
        db,
      );

      expect(detail).toMatchObject({
        id: task.id,
        spaceType: "team",
        assigneeName: member.nickname,
        assigneeEmail: "member@example.com",
        creatorName: owner.nickname,
        subtasks: [
          expect.objectContaining({ title: "已完成", completed: true }),
          expect.objectContaining({ title: "未完成", completed: false }),
        ],
        comments: [expect.objectContaining({ content: "评论", authorName: owner.nickname })],
      });
      expect(detail!.projectName).toBeTruthy();
      expect(detail!.progress).toBe(0.5);
    });
  });

  describe("开始时间校验", () => {
    it("创建：格式非法与开始晚于截止都按字段 startDate 拒绝", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);

      await expect(
        createTeamTask(
          { teamId: team.id, projectId: project.id, actorId: owner.id, title: "格式", startDate: "2026/10/28" },
          db,
        ),
      ).rejects.toMatchObject({ field: "startDate" });
      await expect(
        createTeamTask(
          {
            teamId: team.id,
            projectId: project.id,
            actorId: owner.id,
            title: "晚于截止",
            startDate: "2026-11-02",
            dueDate: "2026-11-01",
          },
          db,
        ),
      ).rejects.toMatchObject({ field: "startDate" });
      expect(await db.select().from(tasks)).toHaveLength(0);
    });

    it("更新：把截止时间改早于已有开始时间被拦截，同时提前开始时间则放行", async () => {
      const { owner, team, project } = await setupTeamWithProject(db);
      const task = await createTeamTask(
        {
          teamId: team.id,
          projectId: project.id,
          actorId: owner.id,
          title: "日期联动",
          startDate: "2026-10-01",
          dueDate: "2026-10-31",
        },
        db,
      );

      await expect(
        updateTeamTask({ teamId: team.id, taskId: task.id, actorId: owner.id, dueDate: "2026-09-30" }, db),
      ).rejects.toMatchObject({ field: "startDate" });

      const updated = await updateTeamTask(
        {
          teamId: team.id,
          taskId: task.id,
          actorId: owner.id,
          startDate: "2026-09-01",
          dueDate: "2026-09-30",
        },
        db,
      );
      expect(updated).toMatchObject({ startDate: "2026-09-01", dueDate: "2026-09-30" });
    });
  });
});
