import { eq, and } from "drizzle-orm";
import type { TeamMembership } from "@open-doing/types";

import { db, type DbClient } from "@/server/db/client";
import { teamMemberships } from "@/server/db/schema";

export type TeamRole = "owner" | "admin" | "member";

/**
 * 团队级动作（对齐设计文档 §5 角色矩阵）。
 *
 * J/G 轨道只消费这些名字，不自行实现权限判定。
 */
export type TeamAction =
  | "team:view"
  | "team:rename"
  | "team:invite"
  | "team:remove_member"
  | "team:manage_projects"
  | "team:dissolve"
  | "team:transfer"
  | "team:leave";

/** 全仓唯一一类权限错误：调用方可稳定映射为 403。 */
export class TeamPermissionError extends Error {
  readonly action: TeamAction;

  constructor(action: TeamAction) {
    super("没有权限执行该操作");
    this.name = "TeamPermissionError";
    this.action = action;
  }
}

/**
 * 角色权限矩阵（唯一实现处，设计 §5）：
 *
 * | 动作                     | owner | admin | member |
 * |--------------------------|-------|-------|--------|
 * | team:view                | ✅    | ✅    | ✅     |
 * | team:rename              | ✅    | ✅    | ❌     |
 * | team:invite              | ✅    | ✅    | ❌     |
 * | team:remove_member       | ✅    | ✅    | ❌     |
 * | team:manage_projects     | ✅    | ✅    | ❌     |
 * | team:dissolve            | ✅    | ❌    | ❌     |
 * | team:transfer            | ✅    | ❌    | ❌     |
 * | team:leave               | ❌（须先转让/解散） | ✅ | ✅ |
 *
 * `role` 为 null（非成员）时一律拒绝。
 */
export function can(role: TeamRole | null, action: TeamAction): boolean {
  if (role === null) return false;

  switch (action) {
    case "team:view":
      return true;
    case "team:rename":
    case "team:invite":
    case "team:remove_member":
    case "team:manage_projects":
      return role === "owner" || role === "admin";
    case "team:dissolve":
    case "team:transfer":
      return role === "owner";
    case "team:leave":
      return role === "admin" || role === "member";
  }
}

/** 断言角色可执行动作，否则抛出 `TeamPermissionError`。 */
export function assertCan(role: TeamRole | null, action: TeamAction): void {
  if (!can(role, action)) {
    throw new TeamPermissionError(action);
  }
}

/** 成员关系行 -> 领域对象（时间转 ISO 字符串）。 */
export function toMembership(row: typeof teamMemberships.$inferSelect): TeamMembership {
  return {
    id: row.id,
    teamId: row.teamId,
    userId: row.userId,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/**
 * 查询用户在某团队的成员关系，未加入返回 null。
 *
 * （§3 共享契约中的 `getMembership`。）
 */
export async function getMembership(
  teamId: string,
  userId: string,
  client: DbClient = db,
): Promise<TeamMembership | null> {
  const [row] = await client
    .select()
    .from(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
    .limit(1);
  return row ? toMembership(row) : null;
}
