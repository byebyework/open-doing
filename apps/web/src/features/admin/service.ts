import { asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";

import type { DomainErrorI18n } from "@/lib/domain-error";
import { todayInShanghai } from "@/lib/today";
import { db, type DbClient } from "@/server/db/client";
import {
  projects,
  registrationCodes,
  sessions,
  tasks,
  teamMemberships,
  teams,
  users,
} from "@/server/db/schema";

/** 管理概览：全量计数与注册码余量（均为实时查询，无缓存）。 */
export interface AdminOverviewStats {
  userCount: number;
  /** 管理员账号数（`users.is_admin`）。 */
  adminCount: number;
  /** 已禁用账号数（`users.is_disabled`）。 */
  disabledCount: number;
  teamCount: number;
  /** 团队成员关系条数（`team_memberships` 行数）。 */
  membershipCount: number;
  projectCount: number;
  /** 个人项目数（`projects.owner_id` 非空）。 */
  personalProjectCount: number;
  /** 团队项目数（`projects.team_id` 非空）。 */
  teamProjectCount: number;
  taskCount: number;
  /** 当前逾期任务数（未完成且截止日早于 Asia/Shanghai 的今天）。 */
  overdueTaskCount: number;
  regCodeCount: number;
  regCodeTotalQuota: number;
  regCodeUsed: number;
  regCodeRemaining: number;
}

/** 注册码 + 凭码注册的使用者（按注册时间升序）。 */
export interface AdminCodeRow {
  code: string;
  maxUses: number;
  usedCount: number;
  createdAt: string;
  usedBy: {
    id: string;
    uid: string;
    username: string;
    nickname: string | null;
    createdAt: string;
  }[];
}

/** 用户列表行 / 详情页头部的可序列化摘要。 */
export interface AdminUserSummary {
  id: string;
  uid: string;
  username: string;
  nickname: string | null;
  email: string | null;
  teamCount: number;
  isAdmin: boolean;
  isDisabled: boolean;
  createdAt: string;
}

/** 用户详情：账号摘要 + 注册码 + 团队归属 + 最近会话（最多 10 条）。 */
export interface AdminUserDetail {
  user: AdminUserSummary & { registrationCode: string | null };
  teams: {
    id: string;
    name: string;
    role: "owner" | "admin" | "member";
    joinedAt: string;
  }[];
  sessions: {
    id: string;
    createdAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }[];
}

/**
 * 管理台领域错误。
 *
 * 与 `features/teams/service.ts` 的 TeamError 同构：`message` 是 zh 兜底，
 * 不直接展示；`i18n` 携带 admin 命名空间的 key（如 "selfOperation"），
 * Task 6 的 action 层按请求语言翻译并通过 `field ?? "form"` 回填表单。
 */
export class AdminError extends Error {
  readonly field: string;
  readonly i18n?: DomainErrorI18n;

  constructor(message: string, field: string = "form", i18n?: DomainErrorI18n) {
    super(message);
    this.name = "AdminError";
    this.field = field;
    this.i18n = i18n;
  }
}

function targetNotFound(): AdminError {
  return new AdminError("目标用户不存在或已被删除", "form", {
    key: "targetNotFound",
  });
}

function selfOperation(): AdminError {
  return new AdminError("不能对自己执行该操作", "form", {
    key: "selfOperation",
  });
}

/**
 * 把用户输入转义为 ILIKE 字面量。
 *
 * PostgreSQL 的 LIKE / ILIKE 在未显式声明 `ESCAPE` 时默认转义符就是反斜杠
 * （standard_conforming_strings 只影响字面量，不影响绑定参数），因此这里把
 * `\` 加倍、并在 `%` / `_` 前加反斜杠即可让它们按字面量匹配。选此方案而
 * 不是 `sql` 模板拼 `ESCAPE` 子句，是为了继续使用 drizzle 类型安全的
 * `ilike()`（它不提供 ESCAPE 参数）。
 */
function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 管理概览：五张表计数 + 注册码名额汇总。
 *
 * 注册码的 `totalQuota` / `used` 是 SUM（无行时 coalesce 为 0），
 * `remaining = totalQuota - used`（可能为负，表示历史码超发，原样暴露）。
 * 逾期的口径与 `isOverdue` 一致：未完成（status !== "done"）且
 * `due_date < 今天`；「今天」取 Asia/Shanghai，避免服务器时区漂移。
 */
export async function getAdminOverview(
  client: DbClient = db,
): Promise<AdminOverviewStats> {
  const today = todayInShanghai();

  const [userRows, teamRows, membershipRows, projectRows, taskRows, codeRows] =
    await Promise.all([
      client
        .select({
          userCount: sql<number>`count(*)::int`,
          adminCount: sql<number>`(count(*) filter (where ${users.isAdmin}))::int`,
          disabledCount: sql<number>`(count(*) filter (where ${users.isDisabled}))::int`,
        })
        .from(users),
      client.select({ value: sql<number>`count(*)::int` }).from(teams),
      client
        .select({ value: sql<number>`count(*)::int` })
        .from(teamMemberships),
      client
        .select({
          projectCount: sql<number>`count(*)::int`,
          personalProjectCount: sql<number>`(count(*) filter (where ${projects.ownerId} is not null))::int`,
          teamProjectCount: sql<number>`(count(*) filter (where ${projects.teamId} is not null))::int`,
        })
        .from(projects),
      client
        .select({
          taskCount: sql<number>`count(*)::int`,
          overdueTaskCount: sql<number>`(count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}::date))::int`,
        })
        .from(tasks),
      client
        .select({
          count: sql<number>`count(*)::int`,
          totalQuota: sql<number>`coalesce(sum(${registrationCodes.maxUses}), 0)::int`,
          used: sql<number>`coalesce(sum(${registrationCodes.usedCount}), 0)::int`,
        })
        .from(registrationCodes),
    ]);

  const regCodeTotalQuota = codeRows[0]!.totalQuota;
  const regCodeUsed = codeRows[0]!.used;

  return {
    userCount: userRows[0]!.userCount,
    adminCount: userRows[0]!.adminCount,
    disabledCount: userRows[0]!.disabledCount,
    teamCount: teamRows[0]!.value,
    membershipCount: membershipRows[0]!.value,
    projectCount: projectRows[0]!.projectCount,
    personalProjectCount: projectRows[0]!.personalProjectCount,
    teamProjectCount: projectRows[0]!.teamProjectCount,
    taskCount: taskRows[0]!.taskCount,
    overdueTaskCount: taskRows[0]!.overdueTaskCount,
    regCodeCount: codeRows[0]!.count,
    regCodeTotalQuota,
    regCodeUsed,
    regCodeRemaining: regCodeTotalQuota - regCodeUsed,
  };
}

/**
 * 注册码列表：按创建时间倒序；每码的 usedBy 按凭码用户的注册时间升序。
 *
 * 单条 left join 查询即可：没有使用者的码仍然返回一行（user 侧为 NULL）。
 */
export async function listAdminCodes(
  client: DbClient = db,
): Promise<AdminCodeRow[]> {
  const rows = await client
    .select({
      codeId: registrationCodes.id,
      code: registrationCodes.code,
      maxUses: registrationCodes.maxUses,
      usedCount: registrationCodes.usedCount,
      createdAt: registrationCodes.createdAt,
      userId: users.id,
      uid: users.uid,
      username: users.username,
      nickname: users.name,
      userCreatedAt: users.createdAt,
    })
    .from(registrationCodes)
    .leftJoin(users, eq(users.registrationCodeId, registrationCodes.id))
    .orderBy(desc(registrationCodes.createdAt), asc(users.createdAt));

  // Map 的插入顺序即查询顺序（码按创建时间倒序），usedBy 也保持升序。
  const byCodeId = new Map<string, AdminCodeRow>();
  for (const row of rows) {
    let codeRow = byCodeId.get(row.codeId);
    if (!codeRow) {
      codeRow = {
        code: row.code,
        maxUses: row.maxUses,
        usedCount: row.usedCount,
        createdAt: row.createdAt.toISOString(),
        usedBy: [],
      };
      byCodeId.set(row.codeId, codeRow);
    }
    if (row.userId) {
      codeRow.usedBy.push({
        id: row.userId,
        uid: row.uid!,
        username: row.username!,
        nickname: row.nickname,
        createdAt: row.userCreatedAt!.toISOString(),
      });
    }
  }

  return [...byCodeId.values()];
}

/**
 * 用户列表：`query` 对 username / email / uid 做大小写不敏感的子串匹配；
 * `null`（或 trim 后空串）返回全部用户，按注册时间升序。
 *
 * `teamCount` 用 `left join team_memberships + count(team_memberships.id)`
 * 实现（GROUP BY users.id）：无成员关系时 left join 的 NULL 行让
 * `count(id)` 归零，PostgreSQL 允许仅按主键分组后引用同表其它列。
 * 不用关联子查询：drizzle 的 `buildSelection` 在单表查询中会把选择字段
 * 里的列全部渲染成**不带表名**的标识符，子查询的关联外键引用会因此
 * 解析到内层表而恒为 0（0.45 实测行为）。
 */
export async function listAdminUsers(
  query: string | null,
  client: DbClient = db,
): Promise<AdminUserSummary[]> {
  const trimmed = query?.trim() ?? "";
  // ilike() 不自带通配符：子串匹配需自行包 `%...%`，用户输入先做字面量转义。
  const pattern = trimmed ? `%${escapeLikePattern(trimmed)}%` : null;

  const rows = await client
    .select({
      id: users.id,
      uid: users.uid,
      username: users.username,
      nickname: users.name,
      email: users.email,
      isAdmin: users.isAdmin,
      isDisabled: users.isDisabled,
      createdAt: users.createdAt,
      teamCount: count(teamMemberships.id),
    })
    .from(users)
    .leftJoin(teamMemberships, eq(teamMemberships.userId, users.id))
    .where(
      pattern
        ? or(
            ilike(users.username, pattern),
            ilike(users.email, pattern),
            ilike(users.uid, pattern),
          )
        : undefined,
    )
    .groupBy(users.id)
    .orderBy(asc(users.createdAt), asc(users.username));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * 用户详情：摘要（含注册码）+ 团队归属 + 最近 10 条会话。
 * 未知 userId 返回 null（由页面 / action 决定 404 语义）。
 */
export async function getAdminUserDetail(
  userId: string,
  client: DbClient = db,
): Promise<AdminUserDetail | null> {
  const [row] = await client
    .select({
      id: users.id,
      uid: users.uid,
      username: users.username,
      nickname: users.name,
      email: users.email,
      isAdmin: users.isAdmin,
      isDisabled: users.isDisabled,
      createdAt: users.createdAt,
      registrationCode: registrationCodes.code,
    })
    .from(users)
    .leftJoin(registrationCodes, eq(users.registrationCodeId, registrationCodes.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const [teamCountRows, teamRows, sessionRows] = await Promise.all([
    client
      .select({ value: count() })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, userId)),
    client
      .select({
        id: teams.id,
        name: teams.name,
        role: teamMemberships.role,
        joinedAt: teamMemberships.joinedAt,
      })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(eq(teamMemberships.userId, userId))
      .orderBy(asc(teamMemberships.joinedAt)),
    client
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(10),
  ]);

  return {
    user: {
      id: row.id,
      uid: row.uid,
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      teamCount: teamCountRows[0]!.value,
      isAdmin: row.isAdmin,
      isDisabled: row.isDisabled,
      createdAt: row.createdAt.toISOString(),
      registrationCode: row.registrationCode,
    },
    teams: teamRows.map((team) => ({
      ...team,
      joinedAt: team.joinedAt.toISOString(),
    })),
    sessions: sessionRows.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
    })),
  };
}

/**
 * 禁用 / 解禁的共用流程：存在性 → 自我操作 → 更新并确认影响行数。
 *
 * 存在性先于自我检查（与 plan 一致）：自己不存在的 id 仍报 targetNotFound。
 */
async function updateUserFlag(
  targetId: string,
  actorId: string,
  changes: { isAdmin: boolean } | { isDisabled: boolean },
  client: DbClient,
): Promise<void> {
  const [target] = await client
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);

  if (!target) throw targetNotFound();
  if (targetId === actorId) throw selfOperation();

  const updated = await client
    .update(users)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning({ id: users.id });

  // 存在性检查后目标可能被并发删除；以返回行数为最终确认。
  if (updated.length === 0) throw targetNotFound();
}

/** 禁用或解禁用户；不允许操作自己。 */
export async function setUserDisabled(
  targetId: string,
  disabled: boolean,
  actorId: string,
  client: DbClient = db,
): Promise<void> {
  await updateUserFlag(targetId, actorId, { isDisabled: disabled }, client);
}

/** 授予或撤销管理员；不允许操作自己（避免自锁）。 */
export async function setUserAdmin(
  targetId: string,
  admin: boolean,
  actorId: string,
  client: DbClient = db,
): Promise<void> {
  await updateUserFlag(targetId, actorId, { isAdmin: admin }, client);
}
