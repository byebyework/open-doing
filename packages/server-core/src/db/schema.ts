/**
 * Open Doing v1 全量数据库 schema（Drizzle / PostgreSQL）
 *
 * 设计决策（对应 ARCHITECTURE §6 与 F-3 brief）：
 * 1. 全部主键使用原生 `uuid` + `defaultRandom()`（PostgreSQL 内置
 *    `gen_random_uuid()`，无需应用层生成）；外键列使用同一 `uuid` 类型。
 * 2. `teams.slug` 采用**全局唯一**（单列 unique），不按团队内唯一。
 * 3. 个人任务（含个人项目内任务）的 `assignee_id` 应恒为本人——该约束由
 *    **应用层 service 断言**保证，不建数据库触发器；数据库只保留可空外键。
 * 4. 级联删除路径全部落在外键 `onDelete` 上，作为应用层二次确认后的兜底。
 * 5. 通知幂等索引 `(user_id, task_id, type) WHERE task_id IS NOT NULL`
 *    是 N-3 幂等投递的数据库依据；`task_id IS NULL` 的行不占用该部分唯一索引。
 * 6. 认证由 better-auth 负责：`users` 即其 user 模型（`name` / `email`
 *    / `emailVerified` / `image` / `displayUsername`），另有 `sessions`
 *    / `accounts` / `verifications` 三表；密码存于 `accounts.password`，
 *    不再有 `users.password_hash` / `users.nickname`。
 * 7. 团队入群码 `teams.join_code` 由应用层生成（8 位、31 字符集），全局唯一；
 *    唯一性落为独立的表级唯一索引。
 *    `join_code_enabled` 控制该团队是否接受凭码加入申请。
 * 8. `team_invites` / `team_join_requests` 使用 `WHERE status = 'pending'`
 *    的部分唯一索引：同一 (team, invitee) / (team, user) 同时只允许一条
 *    pending 记录。终态各自独立：`team_invites` 为
 *    accepted/declined/rescinded，`team_join_requests` 为
 *    approved/declined/cancelled；终态不占用唯一索引。
 * 9. 标识/枚举列直接使用 `text`——PostgreSQL 的 text 等值/唯一比较默认
 *    大小写敏感，天然保持精确匹配语义；内容列同样使用 `text`。
 *    时间戳使用 `timestamptz`（存绝对时刻，不依赖会话时区），默认 `now()`；
 *    日期列使用 `date`（按天粒度，字符串模式）。
 * 10. 虚拟团队是 `teams.kind` 取 `'real' | 'virtual'` 的普通团队行（约束落为
 *     CHECK），虚拟成员不进 `users`，独立存于 `virtual_members`。
 *     `tasks` / `comments` / `notifications` 的虚拟外键与真人外键
 *     **互斥共存**：指派/作者/actor 要么是真人、要么是虚拟成员，由 CHECK 保证
 *     三处都只禁止「同时非空」，允许双空。`comments` 不能沿用 projects 的
 *     「恰好一者非空」XOR：虚拟成员评论时 `author_id` 已为 NULL，删除虚拟
 *     成员触发 `author_virtual_id` 的 `ON DELETE SET NULL`，该 UPDATE 会产生
 *     双空行；XOR 会使删除虚拟成员的 UPDATE 直接违反 CHECK（PostgreSQL 的
 *     CHECK 不可延迟），而规格要求评论保留、退化为「无署名」。真人评论仍恒有
 *     `author_id`，双空行只可能来自被移除的虚拟作者，由服务层按「已移除成员」
 *     展示。`api_tokens` 把 token 绑定到 `(真人, 虚拟成员, 团队)`，每个虚拟
 *     成员至多一条（重签须先删旧行）。
 */
import { isNotNull, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  Gender,
  NotificationType,
  SpaceType,
  TaskPriority,
  TaskStatus,
  TeamJoinStatus,
} from "@open-doing/types";

/** UUID 主键：原生 `uuid` + 数据库端 `gen_random_uuid()`。 */
const uuidPk = () => uuid("id").primaryKey().defaultRandom();

/** UUID 外键列（可空性由调用方 `.notNull()` 决定）。 */
const uuidRef = (name: string) => uuid(name);

/**
 * 用户：同时充当 better-auth 的 `user` 模型。
 *
 * - 字段名与 better-auth 的 user 模型一一对应（TS 属性名），列名保持 snake_case；
 * - `username` / `displayUsername` 由 username 插件使用（大小写敏感，
 *   `usernameNormalization: false`）；
 * - 旧自研密码列已移除，密码存于 `accounts.password`；
 * - `name` 承载展示名（原 nickname 语义），`email` 必填且全库唯一。
 */
export const users = pgTable("users", {
  id: uuidPk(),
  // 业务 UID（doing_xxxx），仅用于邀请；与 better-auth 字段无关。
  uid: text("uid").notNull().unique(),
  username: text("username").notNull().unique(),
  // 展示名（可重复，不唯一），对应原 nickname。
  name: text("name").notNull(),
  // 邮箱必填、全库唯一；大小写不敏感语义，写入前由应用层 lowercase 归一化。
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // username 插件的展示用户名（大小写敏感，不归一化）。
  displayUsername: text("display_username").notNull(),
  // 可选资料：NULL 表示未填写。
  gender: text("gender").$type<Gender>(),
  phone: text("phone").unique(),
  // 个人设置：临期 / 逾期提醒开关，默认开启；存量用户由 DEFAULT 回填。
  dueSoonReminderEnabled: boolean("due_soon_reminder_enabled").notNull().default(true),
  overdueReminderEnabled: boolean("overdue_reminder_enabled").notNull().default(true),
  // 个人设置：界面语言（'zh' | 'en'），默认中文；账号级偏好，登录后每请求生效。
  language: text("language").notNull().default("zh"),
  // 管理员工作台（2026-11-14）：is_admin 权限标记；is_disabled 禁用标记（登录被拒 + 会话清除）；
  // registration_code_id 记录注册时消费的码，支撑管理台「使用者列表」，存量用户为 NULL。
  isAdmin: boolean("is_admin").notNull().default(false),
  isDisabled: boolean("is_disabled").notNull().default(false),
  registrationCodeId: uuidRef("registration_code_id").references(
    () => registrationCodes.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** better-auth 会话：token 唯一，userId 级联删除。 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuidPk(),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** better-auth 账号：密码凭据（providerId = "credential"）存于 password。 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuidPk(),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    // 仅 email/password 凭据账号有值；NULL 表示 OAuth 等无密码账号。
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

/** better-auth 验证码 / 一次性令牌。 */
export const verifications = pgTable(
  "verifications",
  {
    id: uuidPk(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/**
 * 注册码（封测）：凭码注册，一码多用、固定次数上限。
 *
 * 与团队入群码同族（见文件头决策 7）：码由应用层生成（8 位、31 字符集），
 * 唯一性落为独立的表级唯一索引。`used_count` 由原子条件更新扣减
 * （`WHERE used_count < max_uses`），并发下不会超发；无过期时间。
 */
export const registrationCodes = pgTable(
  "registration_codes",
  {
    id: uuidPk(),
    code: text("code").notNull(),
    maxUses: integer("max_uses").notNull().default(10),
    usedCount: integer("used_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("registration_codes_code_unique").on(t.code)],
);

/** 团队：slug 全局唯一；join_code 由应用层生成（见文件头决策 7）；kind 区分真实/虚拟团队（决策 10）。 */
export const teams = pgTable(
  "teams",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    joinCode: text("join_code").notNull(),
    joinCodeEnabled: boolean("join_code_enabled").notNull().default(true),
    // 虚拟团队复用同一套空间/路由/模块栈，仅以 kind 标记（存量团队默认 real）。
    kind: text("kind").$type<"real" | "virtual">().notNull().default("real"),
    ownerId: uuidRef("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 独立唯一索引（非列级 .unique()），与迁移中的表级索引名一致。
    uniqueIndex("teams_join_code_unique").on(t.joinCode),
    check("teams_kind_check", sql`${t.kind} IN ('real', 'virtual')`),
  ],
);

/** 团队成员关系：同一用户在同一团队只允许一条。 */
export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuidRef("user_id")
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
    status: text("status")
      .$type<"pending" | "accepted" | "declined" | "rescinded">()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    // 谓词必须用原始 sql 字符串：drizzle-kit 0.31.11 会把 `.where(eq(...))`
    // 渲染成 DDL 里的 `$1` 绑定参数，导致 `db:migrate` 失败；不要改回 eq()。
    uniqueIndex("team_invites_pending_team_invitee_unique")
      .on(t.teamId, t.inviteeId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** 凭码加入申请：pending 状态对同一 (team, user) 只允许一条（部分唯一索引）。 */
export const teamJoinRequests = pgTable(
  "team_join_requests",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<TeamJoinStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    respondedById: uuidRef("responded_by_id").references(() => users.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    // 同 team_invites：谓词必须用原始 sql 字符串，不能用 eq()，否则
    // drizzle-kit 0.31.11 会渲染出 `$1` 绑定参数使 `db:migrate` 失败。
    uniqueIndex("team_join_requests_pending_team_user_unique")
      .on(t.teamId, t.userId)
      .where(sql`${t.status} = 'pending'`),
    // 「我的申请」查询：按用户列出其加入申请。
    index("team_join_requests_user_id_idx").on(t.userId),
  ],
);

/**
 * 虚拟成员（agent）：不属于 `users` 的团队级身份（决策 10）。
 *
 * - 同一团队内名称唯一，跨团队可同名；
 * - `role` 仅影响团队内权限（admin 可管理成员/任务），无登录能力；
 * - 创建人删除时整个成员行随之级联删除。
 */
export const virtualMembers = pgTable(
  "virtual_members",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").$type<"admin" | "member">().notNull().default("member"),
    description: text("description"),
    // 头像色（无对应 token，允许字面量色值，见 UI 调色板）。
    accentColor: text("accent_color"),
    createdById: uuidRef("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("virtual_members_team_id_name_unique").on(t.teamId, t.name),
    // 查询索引：按团队列出虚拟成员。
    index("virtual_members_team_id_idx").on(t.teamId),
  ],
);

/** 项目：团队项目与个人项目二选一（team_id / owner_id 互斥 CHECK）。 */
export const projects = pgTable(
  "projects",
  {
    id: uuidPk(),
    teamId: uuidRef("team_id").references(() => teams.id, { onDelete: "cascade" }),
    ownerId: uuidRef("owner_id").references(() => users.id, { onDelete: "cascade" }),
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
      .where(isNotNull(t.teamId)),
    uniqueIndex("projects_owner_id_slug_unique")
      .on(t.ownerId, t.slug)
      .where(isNotNull(t.ownerId)),
    // 查询索引：个人项目列表 / 归属校验。
    index("projects_owner_id_idx").on(t.ownerId),
  ],
);

/** 任务：project_id 可空（零散个人任务）；assignee_id / assignee_virtual_id 互斥可空（成员退出后未指派）。 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuidPk(),
    projectId: uuidRef("project_id").references(() => projects.id, { onDelete: "cascade" }),
    spaceType: text("space_type").$type<SpaceType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    // 优先级三档，存量任务由默认值自动归入「中」。
    priority: text("priority").$type<TaskPriority>().notNull().default("medium"),
    // 成员被移除/退出时置空，不删除任务。
    assigneeId: uuidRef("assignee_id").references(() => users.id, { onDelete: "set null" }),
    // 虚拟成员被移除时同样置空；与 assignee_id 不可同时非空（决策 10）。
    assigneeVirtualId: uuidRef("assignee_virtual_id").references(() => virtualMembers.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date", { mode: "string" }),
    // 开始日期（按天，与 due_date 同粒度）；可空，晚于 due_date 在服务层校验拦截。
    startDate: date("start_date", { mode: "string" }),
    createdById: uuidRef("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_assignee_id_idx").on(t.assigneeId),
    index("tasks_assignee_virtual_id_idx").on(t.assigneeVirtualId),
    index("tasks_status_due_date_idx").on(t.status, t.dueDate),
    index("tasks_space_type_idx").on(t.spaceType),
    check(
      "tasks_assignee_exclusive_check",
      sql`NOT (${t.assigneeId} IS NOT NULL AND ${t.assigneeVirtualId} IS NOT NULL)`,
    ),
  ],
);

/** 子任务：仅完成/未完成，无责任人、无截止日期。 */
export const subtasks = pgTable("subtasks", {
  id: uuidPk(),
  taskId: uuidRef("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * 任务评论：个人任务下即自我备注；作者为真人或虚拟成员，不可同时非空（决策 10）。
 *
 * 双空行仅来自虚拟成员被删除后的历史评论（`author_virtual_id` 被 SET NULL
 * 置空），此时按「已移除成员 / 无署名」展示。
 */
export const comments = pgTable(
  "comments",
  {
    id: uuidPk(),
    taskId: uuidRef("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // 放宽为可空：虚拟成员评论时 author_id 为 NULL；删用户仍级联删除评论。
    authorId: uuidRef("author_id").references(() => users.id, { onDelete: "cascade" }),
    // 虚拟成员被移除时置空，评论退化为无署名（不删除评论）。
    authorVirtualId: uuidRef("author_virtual_id").references(() => virtualMembers.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 只禁止同时非空（不用 XOR，理由见文件头决策 10）：删除虚拟成员时
    // SET NULL 会把纯虚拟作者的评论变成双空行，XOR 会阻塞该 UPDATE。
    check(
      "comments_author_exclusive_check",
      sql`NOT (${t.authorId} IS NOT NULL AND ${t.authorVirtualId} IS NOT NULL)`,
    ),
  ],
);

/** 系统内通知：task_id 非空时同一 (user, task, type) 幂等；actor 为真人或虚拟成员，不可同时非空（决策 10）。 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuidPk(),
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    read: boolean("read").notNull().default(false),
    teamId: uuidRef("team_id").references(() => teams.id, { onDelete: "cascade" }),
    projectId: uuidRef("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuidRef("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuidRef("actor_id").references(() => users.id, { onDelete: "cascade" }),
    // 虚拟成员成为通知 actor 时记录；被移除后置空（与 actor_id 不可同时非空）。
    actorVirtualId: uuidRef("actor_virtual_id").references(() => virtualMembers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // N-3 幂等投递依赖：同一用户、同一任务、同一类型只保留一条；
    // task_id 为 NULL 的行不占用该部分唯一索引。
    uniqueIndex("notifications_user_task_type_unique")
      .on(t.userId, t.taskId, t.type)
      .where(isNotNull(t.taskId)),
    // 通知中心未读角标查询。
    index("notifications_user_id_read_idx").on(t.userId, t.read),
    check(
      "notifications_actor_exclusive_check",
      sql`NOT (${t.actorId} IS NOT NULL AND ${t.actorVirtualId} IS NOT NULL)`,
    ),
  ],
);

/**
 * API token（MCP 凭证，Phase 2）：把 token 绑定到 (真人, 虚拟成员, 团队)。
 *
 * - 每个虚拟成员至多一条（`api_tokens_virtual_member_id_unique`），
 *   重签 = 删旧行 + 插新行；
 * - 只存 `sha256(rawToken)`，原文仅签发时返回一次；
 * - 删虚拟成员/团队/用户时级联清空。
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuidPk(),
    // 签发/归属的真人（被 token 冒用的虚拟成员所在团队的 owner/admin）。
    userId: uuidRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    virtualMemberId: uuidRef("virtual_member_id")
      .notNull()
      .references(() => virtualMembers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    // `odm_` 前缀的短标识，供管理界面展示，不含密钥。
    tokenPrefix: text("token_prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("api_tokens_virtual_member_id_unique").on(t.virtualMemberId)],
);
