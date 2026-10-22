import { describe, expect, it } from "vitest";

import {
  TeamPermissionError,
  assertCan,
  can,
  type TeamAction,
  type TeamRole,
} from "./permissions";

describe("can：设计文档 §5 角色矩阵（表驱动）", () => {
  const allActions: TeamAction[] = [
    "team:view",
    "team:rename",
    "team:invite",
    "team:remove_member",
    "team:manage_projects",
    "team:dissolve",
    "team:transfer",
    "team:leave",
  ];

  /** 每个动作对 [owner, admin, member] 的期望（null 角色一律 false）。 */
  const matrix: Record<TeamAction, [boolean, boolean, boolean]> = {
    "team:view": [true, true, true],
    "team:rename": [true, true, false],
    "team:invite": [true, true, false],
    "team:remove_member": [true, true, false],
    "team:manage_projects": [true, true, false],
    "team:dissolve": [true, false, false],
    "team:transfer": [true, false, false],
    // owner 不能直接退出，必须先转让或解散（设计 §6）。
    "team:leave": [false, true, true],
  };

  const roles: TeamRole[] = ["owner", "admin", "member"];

  it.each(allActions)("%s", (action) => {
    const [ownerOk, adminOk, memberOk] = matrix[action];
    const expected = [ownerOk, adminOk, memberOk];

    roles.forEach((role, index) => {
      expect(can(role, action), `${role} x ${action}`).toBe(expected[index]);
    });
    expect(can(null, action), `非成员 x ${action}`).toBe(false);
  });

  it("assertCan：允许时不抛错，拒绝时抛出带 action 的 TeamPermissionError", () => {
    expect(() => assertCan("owner", "team:dissolve")).not.toThrow();

    try {
      assertCan("member", "team:invite");
      throw new Error("应抛出 TeamPermissionError");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamPermissionError);
      expect(error).toMatchObject({ action: "team:invite" });
    }

    expect(() => assertCan(null, "team:view")).toThrow(TeamPermissionError);
  });
});
