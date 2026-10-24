import { and, eq, inArray } from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { projects, tasks, teamMemberships, teams } from "@/server/db/schema";

import {
  assertCan,
  getMembership,
  TeamPermissionError,
  type TeamAction,
} from "../permissions";

export type MemberErrorCode = "NOT_FOUND";

/**
 * 成员领域错误。
 *
 * `field` 供 Server Action 映射为表单字段错误；
 * `NOT_FOUND` 统一表示「成员不存在或已退出」，覆盖重复移除与已退出场景。
 */
export class MemberError extends Error {
  readonly code: MemberErrorCode;
  readonly field = "form" as const;

  constructor(code: MemberErrorCode, message: string) {
    super(message);
    this.name = "MemberError";
    this.code = code;
  }
}

/**
 * 团队策略性拒绝（须先转让等），仍是权限错误的一种，调用方按 403 处理；
 * 但覆盖默认文案，便于 UI 展示可操作提示。
 */
class TeamPolicyError extends TeamPermissionError {
  constructor(action: TeamAction, message: string) {
    super(action);
    // Error.message 在构造后可写；实例仍是 TeamPermissionError。
    this.message = message;
  }
}

export type GovernanceErrorCode = "TEAM_NOT_FOUND" | "TARGET_NOT_MEMBER" | "SELF_TRANSFER";

/**
 * 转让 / 解散领域错误。
 *
 * 与权限错误区分：团队目标已不存在、受让人不是成员、转让给自己等
 * 属于业务约束而非角色权限，供 Server Action 映射为表单错误。
 */
export class GovernanceError extends Error {
  readonly code: GovernanceErrorCode;
  readonly field = "form" as const;

  constructor(code: GovernanceErrorCode, message: string) {
    super(message);
    this.name = "GovernanceError";
    this.code = code;
  }
}

/** 团队行必须存在：解散后（或错误 id）统一报「团队不存在」。 */
async function assertTeamExists(tx: DbClient, teamId: string): Promise<void> {
  const [row] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row) {
    throw new GovernanceError("TEAM_NOT_FOUND", "团队不存在");
  }
}

/**
 * 删除成员关系，并把该成员在本团队所有项目中的任务责任人置空。
 *
 * 置空范围严格限定为 `project_id in (select id from projects where team_id = ?)`：
 * 其他团队项目与个人项目（含 projectId 为空）的任务不受影响。
 * 调用方负责事务边界（本函数只接收同一个 client/tx）。
 */
async function removeMembershipAndClearAssignments(
  tx: DbClient,
  input: { teamId: string; userId: string },
): Promise<void> {
  await tx
    .delete(teamMemberships)
    .where(
      and(
        eq(teamMemberships.teamId, input.teamId),
        eq(teamMemberships.userId, input.userId),
      ),
    );

  await tx
    .update(tasks)
    .set({ assigneeId: null })
    .where(
      and(
        eq(tasks.assigneeId, input.userId),
        inArray(
          tasks.projectId,
          tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.teamId, input.teamId)),
        ),
      ),
    );
}

export interface RemoveMemberInput {
  teamId: string;
  targetUserId: string;
  actorId: string;
}

/**
 * 移除成员：owner/admin 可操作。
 *
 * - 目标须仍是成员，否则抛「成员不存在或已退出」；
 * - owner 不可被直接移除（须先转让）；
 * - 删除成员关系与清空任务责任人在同一事务内完成。
 */
export async function removeMember(
  input: RemoveMemberInput,
  client: DbClient = db,
): Promise<void> {
  const run = async (tx: DbClient): Promise<void> => {
    // actor 与 target 的成员关系都在同一事务快照内读取。
    const actorMembership = await getMembership(input.teamId, input.actorId, tx);
    assertCan(actorMembership?.role ?? null, "team:remove_member");

    const targetMembership = await getMembership(input.teamId, input.targetUserId, tx);
    if (!targetMembership) {
      throw new MemberError("NOT_FOUND", "成员不存在或已退出");
    }
    if (targetMembership.role === "owner") {
      throw new TeamPolicyError("team:transfer", "请先转让团队后再移除成员");
    }

    await removeMembershipAndClearAssignments(tx, {
      teamId: input.teamId,
      userId: input.targetUserId,
    });
  };

  // 已在事务内（嵌套调用）时直接复用，避免重复开事务。
  return client === db ? db.transaction(run) : run(client);
}

export interface LeaveTeamInput {
  teamId: string;
  actorId: string;
}

/**
 * 主动退出团队：admin/member 可操作，owner 须先转让或解散。
 *
 * 语义与 removeMember 一致：删除本人成员关系并在同一事务内
 * 清空本团队项目内其任务责任人（任务本身保留）。
 */
export async function leaveTeam(
  input: LeaveTeamInput,
  client: DbClient = db,
): Promise<void> {
  const run = async (tx: DbClient): Promise<void> => {
    const actorMembership = await getMembership(input.teamId, input.actorId, tx);

    // owner 先给出可操作文案；其余角色交给统一权限矩阵判定。
    if (actorMembership?.role === "owner") {
      throw new TeamPolicyError("team:leave", "请先转让团队或解散团队");
    }
    assertCan(actorMembership?.role ?? null, "team:leave");

    await removeMembershipAndClearAssignments(tx, {
      teamId: input.teamId,
      userId: input.actorId,
    });
  };

  return client === db ? db.transaction(run) : run(client);
}

export interface TransferTeamInput {
  teamId: string;
  targetUserId: string;
  actorId: string;
}

/**
 * 转让团队所有权：仅 owner 可操作。
 *
 * - 受让人必须是现有成员（不能转让给外人，也不能转让给自己）；
 * - 同一事务内完成三处写入：`teams.owner_id`、受让人 membership → owner、
 *   原 owner membership → admin，保证团队内恰一个 owner（Review Focus 3）。
 */
export async function transferTeam(
  input: TransferTeamInput,
  client: DbClient = db,
): Promise<void> {
  const run = async (tx: DbClient): Promise<void> => {
    await assertTeamExists(tx, input.teamId);

    const actorMembership = await getMembership(input.teamId, input.actorId, tx);
    assertCan(actorMembership?.role ?? null, "team:transfer");

    if (input.targetUserId === input.actorId) {
      throw new GovernanceError("SELF_TRANSFER", "不能转让给自己");
    }

    const targetMembership = await getMembership(input.teamId, input.targetUserId, tx);
    if (!targetMembership) {
      throw new GovernanceError("TARGET_NOT_MEMBER", "目标用户不是团队成员");
    }

    await tx
      .update(teams)
      .set({ ownerId: input.targetUserId })
      .where(eq(teams.id, input.teamId));
    await tx
      .update(teamMemberships)
      .set({ role: "owner" })
      .where(
        and(
          eq(teamMemberships.teamId, input.teamId),
          eq(teamMemberships.userId, input.targetUserId),
        ),
      );
    await tx
      .update(teamMemberships)
      .set({ role: "admin" })
      .where(
        and(
          eq(teamMemberships.teamId, input.teamId),
          eq(teamMemberships.userId, input.actorId),
        ),
      );
  };

  return client === db ? db.transaction(run) : run(client);
}

export interface DissolveTeamInput {
  teamId: string;
  actorId: string;
}

/**
 * 解散团队：仅 owner 可操作。
 *
 * 只删除 `teams` 行；项目 / 任务 / 子任务 / 评论 / 邀请 / 成员关系 / 通知
 * 由数据库外键 `ON DELETE CASCADE` 兜底清理（Review Focus 4），应用层不手动删子表。
 */
export async function dissolveTeam(
  input: DissolveTeamInput,
  client: DbClient = db,
): Promise<void> {
  const run = async (tx: DbClient): Promise<void> => {
    await assertTeamExists(tx, input.teamId);

    const actorMembership = await getMembership(input.teamId, input.actorId, tx);
    assertCan(actorMembership?.role ?? null, "team:dissolve");

    await tx.delete(teams).where(eq(teams.id, input.teamId));
  };

  return client === db ? db.transaction(run) : run(client);
}
