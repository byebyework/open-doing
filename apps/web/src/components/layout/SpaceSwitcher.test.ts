import { describe, expect, it } from "vitest";

import { selectedSpaceKey } from "./SpaceSwitcher";

describe("selectedSpaceKey", () => {
  it("/my 精确命中个人空间", () => {
    expect(selectedSpaceKey("/my", ["growth"])).toBe("personal");
  });

  it("个人空间子路径（任务/项目）仍命中个人空间", () => {
    expect(selectedSpaceKey("/my/tasks/t1", [])).toBe("personal");
  });

  it("/teams/{slug} 命中对应团队", () => {
    expect(selectedSpaceKey("/teams/growth", ["growth", "ops"])).toBe("growth");
  });

  it("团队子路径（项目/任务）仍命中该团队", () => {
    expect(
      selectedSpaceKey("/teams/growth/projects/p1/tasks/t1", ["growth", "ops"]),
    ).toBe("growth");
  });

  it("非我的团队不选中", () => {
    expect(selectedSpaceKey("/teams/ops", ["growth"])).toBeNull();
  });

  it("其他路由不选中任何空间", () => {
    expect(selectedSpaceKey("/invites", [])).toBeNull();
  });
});
