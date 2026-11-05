/**
 * Open Doing v1 全量数据库 schema（Drizzle / MySQL 8.0）
 *
 * 设计决策（对应 ARCHITECTURE §6 与 F-3 brief）：
 * 1. 全部主键使用 `char(36)`；UUID 由应用层 `crypto.randomUUID()` 生成
 *    （MySQL 无 `gen_random_uuid()`），外键列使用同一类型。
 * 2. `teams.slug` 采用**全局唯一**（单列 unique），不按团队内唯一。
 * 3. 个人任务（含个人项目内任务）的 `assignee_id` 应恒为本人——该约束由
 *    **应用层 service 断言**保证，不建数据库触发器；数据库只保留可空外键。
 * 4. 级联删除路径全部落在外键 `onDelete` 上，作为应用层二次确认后的兜底。
 * 5. 通知幂等索引 `(user_id, task_id, type)` 是 N-3 幂等投递的数据库依据；
 *    MySQL 唯一索引中 NULL 互不相等，`task_id IS NULL` 的行天然豁免
 *    （等价于 PostgreSQL 的 `WHERE task_id IS NOT NULL` 部分索引）。
 * 6. v1 不建 sessions 表（jose 无状态签名 cookie）。
 * 7. 团队入群码 `teams.join_code` 由应用层生成（8 位、31 字符集），全局唯一；
 *    唯一性落为独立的表级唯一索引。
 *    `join_code_enabled` 控制该团队是否接受凭码加入申请。
 * 8. `team_join_requests` 镜像 team_invites 的 pending 唯一约束：生成列
 *    `pending_scope`（pending 时为 'pending'，否则 NULL）参与唯一索引；
 *    终态（approved/declined/cancelled）不占用。
 * 9. 标识/枚举列使用 `varchar(255) COLLATE utf8mb4_bin`，保持 PostgreSQL 的
 *    精确（大小写敏感）匹配语义；纯内容列使用 `text`。时间戳不带时区，
 *    由连接会话时区（+08:00）统一解释。
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  mysqlTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type {
  NotificationType,
  SpaceType,
  TaskStatus,
  TeamJoinStatus,
} from "@open-doing/types";

/**
 * 标识/枚举列：`varchar(255) COLLATE utf8mb4_bin`。
 *
 * PostgreSQL 的 text 等值/唯一比较是大小写敏感的；MySQL 默认 collation
 * （utf8mb4_0900_ai_ci）不区分大小写，会让 `Alice` / `alice` 在唯一约束和
 * 等值查询上产生 PostgreSQL 不会有的冲突。用二进制 collation 保持精确匹配。
 */
const identifierVarchar = (name: string) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return "varchar(255) COLLATE utf8mb4_bin";
    },
  })(name);

/** UUID 主键：`char(36)` + 应用层生成。 */
const uuidPk = () =>
  char("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** UUID 外键列（可空性由调用方 `.notNull()` 决定）。 */
const uuidRef = (name: string) => char(name, { length: 36 });

/** 用户：用户名 + 密码登录，不收集邮箱；uid 仅用于邀请。 */
export const users = mysqlTable("users", {
  id: uuidPk(),
  uid: identifierVarchar("uid").notNull().unique(),
  username: identifierVarchar("username").notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // 个人设置：临期 / 逾期提醒开关，默认开启；存量用户由 DEFAULT 回填。
  dueSoonReminderEnabled: boolean("due_soon_reminder_enabled").notNull().default(true),
  overdueReminderEnabled: boolean("overdue_reminder_enabled").notNull().default(true),
  // 个人设置：界面语言（'zh' | 'en'），默认中文；账号级偏好，登录后每请求生效。
  language: identifierVarchar("language").notNull().default("zh"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 团队：slug 全局唯一；join_code 由应用层生成（见文件头决策 7）。 */
export const teams = mysqlTable(
  "teams",
  {
    id: uuidPk(),
    name: identifierVarchar("name").notNull(),
    slug: identifierVarchar("slug").notNull().unique(),
    joinCode: identifierVarchar("join_code").notNull(),
    joinCodeEnabled: boolean("join_code_enabled").notNull().default(true),
    ownerId: uuidRef("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // 独立唯一索引（非列级 .unique()），与 PostgreSQL 迁移中的表级索引名一致。
    uniqueIndex("teams_join_code_unique").on(t.joinCode),
  ],
);

/** 团队成员关系：同一用户在同一团队只允许一条。 */
export const teamMemberships = mysqlTable(
  "team_memberships",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: identifierVarchar("role").$type<"owner" | "admin" | "member">().notNull(),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    unique("team_memberships_team_id_user_id_unique").on(t.teamId, t.userId),
    // 查询索引：按用户查其全部团队（D/T 轨道依赖）。
    index("team_memberships_user_id_idx").on(t.userId),
  ],
);

/** 团队邀请：pending 状态对同一 (team, invitee) 只允许一条（生成列唯一索引）。 */
export const teamInvites = mysqlTable(
  "team_invites",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    inviteeId: uuidRef("invitee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedById: uuidRef("invited_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: identifierVarchar("status")
      .$type<"pending" | "accepted" | "declined" | "rescinded">()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    respondedAt: timestamp("responded_at"),
    // 生成列：pending 时为 'pending'，终态为 NULL，使唯一索引只约束 pending。
    // MySQL 索引不支持 TEXT 列（除非前缀长度），故用 varchar。
    pendingScope: varchar("pending_scope", { length: 255 }).generatedAlwaysAs(
      sql`case when status = 'pending' then 'pending' else null end`,
    ),
  },
  (t) => [
    uniqueIndex("team_invites_pending_team_invitee_unique").on(
      t.teamId,
      t.inviteeId,
      t.pendingScope,
    ),
  ],
);

/** 凭码加入申请：pending 状态对同一 (team, user) 只允许一条（生成列唯一索引）。 */
export const teamJoinRequests = mysqlTable(
  "team_join_requests",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: identifierVarchar("status").$type<TeamJoinStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    respondedAt: timestamp("responded_at"),
    respondedById: uuidRef("responded_by_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    // 同 team_invites：pending 才占用唯一索引。
    pendingScope: varchar("pending_scope", { length: 255 }).generatedAlwaysAs(
      sql`case when status = 'pending' then 'pending' else null end`,
    ),
  },
  (t) => [
    uniqueIndex("team_join_requests_pending_team_user_unique").on(
      t.teamId,
      t.userId,
      t.pendingScope,
    ),
    // 「我的申请」查询：按用户列出其加入申请。
    index("team_join_requests_user_id_idx").on(t.userId),
  ],
);

/** 项目：团队项目与个人项目二选一（team_id / owner_id 互斥 CHECK）。 */
export const projects = mysqlTable(
  "projects",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id").references(() => teams.id, { onDelete: "cascade" }),
    ownerId: uuidRef("owner_id").references(() => users.id, { onDelete: "cascade" }),
    name: identifierVarchar("name").notNull(),
    slug: identifierVarchar("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "projects_team_or_owner_check",
      sql`(${t.teamId} IS NOT NULL) <> (${t.ownerId} IS NOT NULL)`,
    ),
    // 团队项目 slug 在团队内唯一；个人项目 slug 在个人空间内唯一。
    // MySQL 唯一索引中 NULL 互不相等，未填的一侧天然不参与约束。
    uniqueIndex("projects_team_id_slug_unique").on(t.teamId, t.slug),
    uniqueIndex("projects_owner_id_slug_unique").on(t.ownerId, t.slug),
    // 查询索引：个人项目列表 / 归属校验。
    index("projects_owner_id_idx").on(t.ownerId),
  ],
);

/** 任务：project_id 可空（零散个人任务）；assignee_id 可空（成员退出后未指派）。 */
export const tasks = mysqlTable(
  "tasks",
  {
    id: uuidPk(),
    projectId: uuidRef("project_id").references(() => projects.id, { onDelete: "cascade" }),
    spaceType: identifierVarchar("space_type").$type<SpaceType>().notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: identifierVarchar("status").$type<TaskStatus>().notNull().default("todo"),
    // 成员被移除/退出时置空，不删除任务。
    assigneeId: uuidRef("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date", { mode: "string" }),
    createdById: uuidRef("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_assignee_id_idx").on(t.assigneeId),
    index("tasks_status_due_date_idx").on(t.status, t.dueDate),
    index("tasks_space_type_idx").on(t.spaceType),
  ],
);

/** 子任务：仅完成/未完成，无责任人、无截止日期。 */
export const subtasks = mysqlTable("subtasks", {
  id: uuidPk(),
  taskId: uuidRef("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

/** 任务评论：个人任务下即自我备注。 */
export const comments = mysqlTable("comments", {
  id: uuidPk(),
  taskId: uuidRef("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  authorId: uuidRef("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 系统内通知：task_id 非空时同一 (user, task, type) 幂等。 */
export const notifications = mysqlTable(
  "notifications",
  {
    id: uuidPk(),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: identifierVarchar("type").$type<NotificationType>().notNull(),
    read: boolean("read").notNull().default(false),
    teamId: uuidRef("team_id").references(() => teams.id, { onDelete: "cascade" }),
    projectId: uuidRef("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuidRef("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuidRef("actor_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // N-3 幂等投递依赖：同一用户、同一任务、同一类型只保留一条。
    // task_id 为 NULL 的行因 MySQL 唯一索引 NULL 互不相等而豁免。
    uniqueIndex("notifications_user_task_type_unique").on(t.userId, t.taskId, t.type),
    // 通知中心未读角标查询。
    index("notifications_user_id_read_idx").on(t.userId, t.read),
  ],
);
