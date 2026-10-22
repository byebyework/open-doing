/**
 * Open Doing v1 全量数据库 schema（Drizzle / PostgreSQL）
 *
 * 设计决策（对应 ARCHITECTURE §6 与 F-3 brief）：
 * 1. 全部主键使用 `uuid().primaryKey().defaultRandom()`。
 * 2. `teams.slug` 采用**全局唯一**（单列 unique），不按团队内唯一。
 * 3. 个人任务（含个人项目内任务）的 `assignee_id` 应恒为本人——该约束由
 *    **应用层 service 断言**保证，不建数据库触发器；数据库只保留可空外键。
 * 4. 级联删除路径全部落在外键 `onDelete` 上，作为应用层二次确认后的兜底。
 * 5. 通知幂等索引 `(user_id, task_id, type) WHERE task_id IS NOT NULL`
 *    是 N-3 幂等投递的数据库依据。
 * 6. v1 不建 sessions 表（jose 无状态签名 cookie）。
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { NotificationType, SpaceType, TaskStatus } from "@open-doing/types";

/** 用户：用户名 + 密码登录，不收集邮箱；uid 仅用于邀请。 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  uid: text("uid").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 团队：slug 全局唯一。 */
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 团队成员关系：同一用户在同一团队只允许一条。 */
export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "member">().notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("team_memberships_team_id_user_id_unique").on(t.teamId, t.userId),
    // 查询索引：按用户查其全部团队（D/T 轨道依赖）。
    index("team_memberships_user_id_idx").on(t.userId),
  ],
);

/** 团队邀请：pending 状态对同一 (team, invitee) 只允许一条（部分唯一索引）。 */
export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedById: uuid("invited_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"pending" | "accepted" | "declined" | "rescinded">()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("team_invites_pending_team_invitee_unique")
      .on(t.teamId, t.inviteeId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** 项目：团队项目与个人项目二选一（team_id / owner_id 互斥 CHECK）。 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "projects_team_or_owner_check",
      sql`(${t.teamId} IS NOT NULL) <> (${t.ownerId} IS NOT NULL)`,
    ),
    // 团队项目 slug 在团队内唯一；个人项目 slug 在个人空间内唯一。
    uniqueIndex("projects_team_id_slug_unique")
      .on(t.teamId, t.slug)
      .where(sql`${t.teamId} IS NOT NULL`),
    uniqueIndex("projects_owner_id_slug_unique")
      .on(t.ownerId, t.slug)
      .where(sql`${t.ownerId} IS NOT NULL`),
    // 查询索引：个人项目列表 / 归属校验。
    index("projects_owner_id_idx").on(t.ownerId),
  ],
);

/** 任务：project_id 可空（零散个人任务）；assignee_id 可空（成员退出后未指派）。 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    spaceType: text("space_type").$type<SpaceType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    // 成员被移除/退出时置空，不删除任务。
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date", { mode: "string" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_assignee_id_idx").on(t.assigneeId),
    index("tasks_status_due_date_idx").on(t.status, t.dueDate),
    index("tasks_space_type_idx").on(t.spaceType),
  ],
);

/** 子任务：仅完成/未完成，无责任人、无截止日期。 */
export const subtasks = pgTable("subtasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** 任务评论：个人任务下即自我备注。 */
export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 系统内通知：task_id 非空时同一 (user, task, type) 幂等。 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    read: boolean("read").notNull().default(false),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // N-3 幂等投递依赖：同一用户、同一任务、同一类型只保留一条。
    uniqueIndex("notifications_user_task_type_unique")
      .on(t.userId, t.taskId, t.type)
      .where(sql`${t.taskId} IS NOT NULL`),
    // 通知中心未读角标查询。
    index("notifications_user_id_read_idx").on(t.userId, t.read),
  ],
);
