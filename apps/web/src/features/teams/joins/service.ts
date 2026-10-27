import { and, asc, eq, inArray } from "drizzle-orm";
import type { TeamJoinRequest } from "@open-doing/types";

import { createNotification } from "@/features/notifications/service";
import { generateJoinCode } from "@/lib/join-code";
import { isUuid } from "@/lib/task-fields";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { teamJoinRequests, teamMemberships, teams, users } from "@/server/db/schema";

import { assertCan, getMembership } from "../permissions";

export type JoinErrorCode =
  | "VALIDATION"
  | "CODE_INVALID"
  | "JOIN_DISABLED"
  | "ALREADY_MEMBER"
  | "PENDING_EXISTS"
  | "INVALID";

export type JoinErrorField = "code" | "form";

/**
 * 凭码加入领域错误。
 *
 * `field` 供 Server Action 映射为表单字段错误；入群码相关错误统一落 `code`。
 * `CODE_INVALID` 的文案不得包含团队名——凭码是可能被猜错的公开入口，
 * 报错不应泄露某个码对应哪个团队。
 */
export class JoinError extends Error {
  readonly code: JoinErrorCode;
  readonly field: JoinErrorField;

  constructor(code: JoinErrorCode, message: string, field: JoinErrorField = "form") {
    super(message);
    this.name = "JoinError";
    this.code = code;
    this.field = field;
  }
}

/** 入群码格式：8 位、剔除易混淆字符（与 generateJoinCode 的字符集一致）。 */
const JOIN_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** 入群码唯一冲突重试上限（镜像 nextFreeSlug 的重试风格）。 */
const MAX_JOIN_CODE_ATTEMPTS = 5;

/** 行 -> 领域对象（时间转 ISO 字符串；未处理时省略 respondedAt/respondedById）。 */
function toJoinRequest(row: typeof teamJoinRequests.$inferSelect): TeamJoinRequest {
  return {
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(row.respondedAt ? { respondedAt: row.respondedAt.toISOString() } : {}),
    ...(row.respondedById ? { respondedById: row.respondedById } : {}),
  };
}

/** 团队加入设置（设置页「凭码加入」区块数据源）。 */
export interface TeamJoinSettings {
  joinCode: string;
  joinCodeEnabled: boolean;
}

/** 审批队列项：申请 + 申请人展示信息。 */
export interface TeamJoinRequestView {
  request: TeamJoinRequest;
  user: { id: string; username: string; uid: string };
}

/** 「我的加入申请」项：申请 + 团队展示信息。 */
export interface MyJoinRequestView {
  request: TeamJoinRequest;
  team: { id: string; name: string; slug: string };
}

/** 读取团队入群码与开关；团队不存在时统一抛 INVALID。 */
export async function getTeamJoinSettings(
  teamId: string,
  client: DbClient = db,
): Promise<TeamJoinSettings> {
  const [row] = await client
    .select({ joinCode: teams.joinCode, joinCodeEnabled: teams.joinCodeEnabled })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!row) {
    throw new JoinError("INVALID", "团队不存在或已失效", "form");
  }

  return row;
}

export interface JoinCodeActorInput {
  teamId: string;
  actorId: string;
}

/**
 * 重置入群码：owner/admin 可操作，旧码立即失效。
 *
 * 每次尝试单独开事务（嵌套调用时即 savepoint）：唯一索引冲突只回滚本次
 * UPDATE，随后换一个随机码重试。
 */
export async function resetJoinCode(
  input: JoinCodeActorInput,
  client: DbClient = db,
): Promise<string> {
  const membership = await getMembership(input.teamId, input.actorId, client);
  assertCan(membership?.role ?? null, "team:invite");

  const attempt = async (tx: DbClient): Promise<string> => {
    const code = generateJoinCode();
    const [row] = await tx
      .update(teams)
      .set({ joinCode: code })
      .where(eq(teams.id, input.teamId))
      .returning({ joinCode: teams.joinCode });

    if (!row) {
      throw new JoinError("INVALID", "团队不存在或已失效", "form");
    }
    return row.joinCode;
  };

  for (let index = 1; index <= MAX_JOIN_CODE_ATTEMPTS; index += 1) {
    try {
      return await client.transaction(attempt);
    } catch (error) {
      // 并发重置撞上全局唯一索引：重新生成后重试。
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new JoinError("VALIDATION", "入群码生成失败，请稍后重试", "form");
}

/** 开关凭码加入：owner/admin 可操作；关闭后仍保留当前码，重新开启即复用。 */
export async function setJoinCodeEnabled(
  input: JoinCodeActorInput & { enabled: boolean },
  client: DbClient = db,
): Promise<void> {
  const membership = await getMembership(input.teamId, input.actorId, client);
  assertCan(membership?.role ?? null, "team:invite");

  const [row] = await client
    .update(teams)
    .set({ joinCodeEnabled: input.enabled })
    .where(eq(teams.id, input.teamId))
    .returning({ id: teams.id });

  if (!row) {
    throw new JoinError("INVALID", "团队不存在或已失效", "form");
  }
}

export interface CreateJoinRequestInput {
  code: string;
  actorId: string;
}

/**
 * 凭码发起加入申请：码归一化后校验格式与存在性，重复/已是成员/团队关闭均拒绝。
 *
 * 申请与「待审批」通知（每个 owner/admin 一条）同事务写入；并发重复提交由
 * pending 部分唯一索引兜底，统一映射为 PENDING_EXISTS。
 */
export async function createJoinRequest(
  input: CreateJoinRequestInput,
  client: DbClient = db,
): Promise<TeamJoinRequest> {
  const code =
    typeof input?.code === "string" ? input.code.trim().toUpperCase() : "";

  // 格式不合法与码不存在共用同一文案，避免泄露团队信息。
  if (!JOIN_CODE_PATTERN.test(code)) {
    throw new JoinError("CODE_INVALID", "入群码无效", "code");
  }

  const [teamRow] = await client
    .select()
    .from(teams)
    .where(eq(teams.joinCode, code))
    .limit(1);

  if (!teamRow) {
    throw new JoinError("CODE_INVALID", "入群码无效", "code");
  }
  if (!teamRow.joinCodeEnabled) {
    throw new JoinError("JOIN_DISABLED", "该团队已关闭凭码加入", "code");
  }
  if (await getMembership(teamRow.id, input.actorId, client)) {
    throw new JoinError("ALREADY_MEMBER", "你已是该团队成员", "code");
  }

  const pending = await client
    .select({ id: teamJoinRequests.id })
    .from(teamJoinRequests)
    .where(
      and(
        eq(teamJoinRequests.teamId, teamRow.id),
        eq(teamJoinRequests.userId, input.actorId),
        eq(teamJoinRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending.length > 0) {
    throw new JoinError("PENDING_EXISTS", "你已提交过加入申请，请等待审批", "code");
  }

  const attemptInsert = async (tx: DbClient): Promise<TeamJoinRequest> => {
    const [row] = await tx
      .insert(teamJoinRequests)
      .values({ teamId: teamRow.id, userId: input.actorId, status: "pending" })
      .returning();

    // 审批人 = 团队全部 owner/admin（member 不参与审批），申请与通知同事务。
    const reviewers = await tx
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamRow.id),
          inArray(teamMemberships.role, ["owner", "admin"]),
        ),
      );
    for (const reviewer of reviewers) {
      await createNotification(
        {
          userId: reviewer.userId,
          type: "team_join_requested",
          teamId: teamRow.id,
          actorId: input.actorId,
        },
        tx,
      );
    }

    return toJoinRequest(row!);
  };

  try {
    // 统一用 client.transaction：传入事务 client 时退化为 savepoint，
    // 保证测试用测试库 client 调用时同样具备原子性。
    return await client.transaction(attemptInsert);
  } catch (error) {
    // 并发竞态：pending 部分唯一索引兜底。
    if (isUniqueViolation(error)) {
      throw new JoinError("PENDING_EXISTS", "你已提交过加入申请，请等待审批", "code");
    }
    throw error;
  }
}

export interface RespondToJoinRequestInput {
  requestId: string;
  actorId: string;
  approve: boolean;
}

/**
 * 审批加入申请：owner/admin 可操作，仅 pending 可响应。
 *
 * 批准时同一事务内写入 member 成员关系并通知申请人；若申请人在此期间已
 * 通过邀请成为成员（成员唯一约束冲突），整事务回滚、申请保持 pending，
 * 统一抛 ALREADY_MEMBER。重复/并发审批由 `status = 'pending'` 条件更新兜底。
 */
export async function respondToJoinRequest(
  input: RespondToJoinRequestInput,
  client: DbClient = db,
): Promise<TeamJoinRequest> {
  if (!input?.requestId || !isUuid(input.requestId)) {
    throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
  }

  const run = async (tx: DbClient): Promise<TeamJoinRequest> => {
    const [row] = await tx
      .select()
      .from(teamJoinRequests)
      .where(eq(teamJoinRequests.id, input.requestId))
      .limit(1);

    if (!row) {
      throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
    }

    const membership = await getMembership(row.teamId, input.actorId, tx);
    assertCan(membership?.role ?? null, "team:invite");

    if (row.status !== "pending") {
      throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
    }

    const [updated] = await tx
      .update(teamJoinRequests)
      .set({
        status: input.approve ? "approved" : "declined",
        respondedAt: new Date(),
        respondedById: input.actorId,
      })
      // 条件更新：并发第二次审批匹配不到行，整事务回滚。
      .where(
        and(
          eq(teamJoinRequests.id, row.id),
          eq(teamJoinRequests.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
    }

    if (input.approve) {
      try {
        await tx
          .insert(teamMemberships)
          .values({ teamId: row.teamId, userId: row.userId, role: "member" });
      } catch (error) {
        if (isUniqueViolation(error)) {
          // 邀请接受竞态：申请人已是成员。抛出后整事务回滚，申请保持 pending。
          throw new JoinError("ALREADY_MEMBER", "该用户已是团队成员", "form");
        }
        throw error;
      }
    }

    await createNotification(
      {
        userId: row.userId,
        type: input.approve ? "team_join_approved" : "team_join_declined",
        teamId: row.teamId,
        actorId: input.actorId,
      },
      tx,
    );

    return toJoinRequest(updated);
  };

  return client.transaction(run);
}

export interface CancelJoinRequestInput {
  requestId: string;
  actorId: string;
}

/**
 * 申请人撤回自己的待处理申请：仅本人 + pending 可取消，不产生任何通知。
 */
export async function cancelJoinRequest(
  input: CancelJoinRequestInput,
  client: DbClient = db,
): Promise<TeamJoinRequest> {
  if (!input?.requestId || !isUuid(input.requestId)) {
    throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
  }

  const run = async (tx: DbClient): Promise<TeamJoinRequest> => {
    const [row] = await tx
      .select()
      .from(teamJoinRequests)
      .where(eq(teamJoinRequests.id, input.requestId))
      .limit(1);

    if (!row || row.userId !== input.actorId || row.status !== "pending") {
      throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
    }

    const [updated] = await tx
      .update(teamJoinRequests)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(teamJoinRequests.id, row.id),
          eq(teamJoinRequests.userId, input.actorId),
          eq(teamJoinRequests.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      throw new JoinError("INVALID", "加入申请不存在或已失效", "form");
    }

    // 撤回不通知审批人（设计：静默取消）。
    return toJoinRequest(updated);
  };

  return client.transaction(run);
}

/** 团队全部加入申请（全状态，UI 自行区分待处理/已处理），createdAt 升序。 */
export async function listTeamJoinRequests(
  teamId: string,
  client: DbClient = db,
): Promise<TeamJoinRequestView[]> {
  const rows = await client
    .select({
      request: teamJoinRequests,
      user: { id: users.id, username: users.username, uid: users.uid },
    })
    .from(teamJoinRequests)
    .innerJoin(users, eq(users.id, teamJoinRequests.userId))
    .where(eq(teamJoinRequests.teamId, teamId))
    .orderBy(asc(teamJoinRequests.createdAt));

  return rows.map((row) => ({ request: toJoinRequest(row.request), user: row.user }));
}

/** 用户发出的全部加入申请（全状态），createdAt 升序。 */
export async function listMyJoinRequests(
  userId: string,
  client: DbClient = db,
): Promise<MyJoinRequestView[]> {
  const rows = await client
    .select({
      request: teamJoinRequests,
      team: { id: teams.id, name: teams.name, slug: teams.slug },
    })
    .from(teamJoinRequests)
    .innerJoin(teams, eq(teams.id, teamJoinRequests.teamId))
    .where(eq(teamJoinRequests.userId, userId))
    .orderBy(asc(teamJoinRequests.createdAt));

  return rows.map((row) => ({ request: toJoinRequest(row.request), team: row.team }));
}
