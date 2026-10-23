import { and, desc, eq } from "drizzle-orm";
import type { TeamInvite } from "@open-doing/types";

import { findByUid } from "@/features/users/service";
import { db, type DbClient } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { teamInvites, users } from "@/server/db/schema";

import { assertCan, getMembership } from "../permissions";
import { createNotification } from "@/features/notifications/service";

export type InviteErrorCode =
  | "VALIDATION"
  | "UID_NOT_FOUND"
  | "SELF"
  | "ALREADY_MEMBER"
  | "PENDING_EXISTS"
  | "INVALID";

export type InviteErrorField = "uid" | "form";

/**
 * 邀请领域错误。
 *
 * `field` 供 Server Action 映射为表单字段错误；`INVALID` 统一表示
 * 「邀请不存在或已失效」（已撤销 / 已响应 / 团队已解散），避免泄露存在性。
 */
export class InviteError extends Error {
  readonly code: InviteErrorCode;
  readonly field: InviteErrorField;

  constructor(code: InviteErrorCode, message: string, field: InviteErrorField = "form") {
    super(message);
    this.name = "InviteError";
    this.code = code;
    this.field = field;
  }
}

/** 行 -> 领域对象（时间转 ISO 字符串；respondedAt 为空时省略）。 */
function toInvite(row: typeof teamInvites.$inferSelect): TeamInvite {
  return {
    id: row.id,
    teamId: row.teamId,
    inviteeId: row.inviteeId,
    invitedById: row.invitedById,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(row.respondedAt ? { respondedAt: row.respondedAt.toISOString() } : {}),
  };
}

export interface CreateInviteInput {
  teamId: string;
  actorId: string;
  uid: string;
}

/**
 * 按 UID 发起邀请：owner/admin 可操作，邀请与通知同事务写入。
 *
 * - UID 必须属于已注册用户，否则抛 uid 字段错误「UID 无效」；
 * - 不能邀请自己 / 已是成员 / 已有 pending 邀请（数据库部分唯一索引兜底）。
 */
export async function createInvite(
  input: CreateInviteInput,
  client: DbClient = db,
): Promise<TeamInvite> {
  const uid = typeof input?.uid === "string" ? input.uid.trim() : "";
  if (!uid) {
    throw new InviteError("UID_NOT_FOUND", "UID 无效", "uid");
  }

  const membership = await getMembership(input.teamId, input.actorId, client);
  assertCan(membership?.role ?? null, "team:invite");

  const invitee = await findByUid(uid, client);
  if (!invitee) {
    throw new InviteError("UID_NOT_FOUND", "UID 无效", "uid");
  }
  if (invitee.id === input.actorId) {
    throw new InviteError("SELF", "不能邀请自己", "uid");
  }
  if (await getMembership(input.teamId, invitee.id, client)) {
    throw new InviteError("ALREADY_MEMBER", "该用户已是团队成员", "uid");
  }

  const pending = await client
    .select({ id: teamInvites.id })
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.teamId, input.teamId),
        eq(teamInvites.inviteeId, invitee.id),
        eq(teamInvites.status, "pending"),
      ),
    )
    .limit(1);
  if (pending.length > 0) {
    throw new InviteError("PENDING_EXISTS", "已向该用户发出待处理邀请", "uid");
  }

  const attemptInsert = async (tx: DbClient): Promise<TeamInvite> => {
    const [row] = await tx
      .insert(teamInvites)
      .values({
        teamId: input.teamId,
        inviteeId: invitee.id,
        invitedById: input.actorId,
        status: "pending",
      })
      .returning();

    // 邀请与通知同事务提交/回滚（INT-1 核验点）。
    await createNotification(
      {
        userId: invitee.id,
        type: "team_invite",
        teamId: input.teamId,
        actorId: input.actorId,
      },
      tx,
    );

    return toInvite(row!);
  };

  try {
    if (client !== db) return await attemptInsert(client);
    return await db.transaction(attemptInsert);
  } catch (error) {
    // 并发竞态：pending 部分唯一索引兜底。
    if (isUniqueViolation(error)) {
      throw new InviteError("PENDING_EXISTS", "已向该用户发出待处理邀请", "uid");
    }
    throw error;
  }
}

export interface RescindInviteInput {
  inviteId: string;
  teamId: string;
  actorId: string;
}

/**
 * 撤销待处理邀请：owner/admin 可操作；仅 pending 可撤销。
 * 撤销不是被邀请人的「响应」，respondedAt 保持为空。
 */
export async function rescindInvite(
  input: RescindInviteInput,
  client: DbClient = db,
): Promise<TeamInvite> {
  const membership = await getMembership(input.teamId, input.actorId, client);
  assertCan(membership?.role ?? null, "team:invite");

  const run = async (tx: DbClient): Promise<TeamInvite> => {
    const [row] = await tx
      .select()
      .from(teamInvites)
      .where(and(eq(teamInvites.id, input.inviteId), eq(teamInvites.teamId, input.teamId)))
      .limit(1);

    if (!row || row.status !== "pending") {
      throw new InviteError("INVALID", "邀请不存在或已失效", "form");
    }

    const [updated] = await tx
      .update(teamInvites)
      .set({ status: "rescinded" })
      .where(eq(teamInvites.id, row.id))
      .returning();

    await createNotification(
      {
        userId: row.inviteeId,
        type: "team_invite",
        teamId: input.teamId,
        actorId: input.actorId,
      },
      tx,
    );

    return toInvite(updated!);
  };

  return client === db ? db.transaction(run) : run(client);
}

export interface SentInviteView {
  invite: TeamInvite;
  invitee: { id: string; uid: string; username: string };
}

/** 团队已发出且待处理的邀请列表，按发出时间倒序。 */
export async function listPendingSentInvites(
  teamId: string,
  client: DbClient = db,
): Promise<SentInviteView[]> {
  const rows = await client
    .select({
      invite: teamInvites,
      invitee: { id: users.id, uid: users.uid, username: users.username },
    })
    .from(teamInvites)
    .innerJoin(users, eq(users.id, teamInvites.inviteeId))
    .where(and(eq(teamInvites.teamId, teamId), eq(teamInvites.status, "pending")))
    .orderBy(desc(teamInvites.createdAt));

  return rows.map((row) => ({ invite: toInvite(row.invite), invitee: row.invitee }));
}
