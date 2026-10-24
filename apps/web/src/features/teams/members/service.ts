import { and, eq, inArray } from "drizzle-orm";

import { db, type DbClient } from "@/server/db/client";
import { projects, tasks, teamMemberships } from "@/server/db/schema";

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
