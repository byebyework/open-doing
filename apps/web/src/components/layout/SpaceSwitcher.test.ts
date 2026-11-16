import { describe, expect, it } from "vitest";

import { selectedSpaceKey } from "./SpaceSwitcher";

describe("selectedSpaceKey", () => {
  it("/space/personal 精确命中个人空间", () => {
    expect(selectedSpaceKey("/space/personal", ["growth"])).toBe("personal");
  });

  it("个人空间子路径（任务/项目）仍命中个人空间", () => {
    expect(selectedSpaceKey("/space/personal/tasks/t1", [])).toBe("personal");
  });

  it("/space/{slug} 命中对应团队", () => {
    expect(selectedSpaceKey("/space/growth", ["growth", "ops"])).toBe("growth");
  });

  it("团队子路径（项目/任务）仍命中该团队", () => {
    expect(
      selectedSpaceKey("/space/growth/projects/p1/tasks/t1", ["growth", "ops"]),
    ).toBe("growth");
  });

  it("非我的团队不选中", () => {
    expect(selectedSpaceKey("/space/ops", ["growth"])).toBeNull();
  });

  it("不在 teamSlugs 中的空间不选中", () => {
    expect(selectedSpaceKey("/space/unknown-team", ["growth"])).toBeNull();
  });

  it("其他路由不选中任何空间", () => {
    expect(selectedSpaceKey("/invites", [])).toBeNull();
  });

  it("创建团队页不选中任何空间", () => {
    expect(selectedSpaceKey("/teams/new", ["growth"])).toBeNull();
  });

  it("凭码加入页不选中任何空间", () => {
    expect(selectedSpaceKey("/teams/join", ["growth"])).toBeNull();
  });
});

describe("selectedSpaceKey urlSpace 分支", () => {
  const slugs = ["growthx", "lab"];
  it("非空间路由 + ambient 团队 slug → 返回该 slug", () => {
    expect(selectedSpaceKey("/about", slugs, "growthx")).toBe("growthx");
  });
  it("非空间路由 + ambient personal → 返回 personal", () => {
    expect(selectedSpaceKey("/invites", slugs, "personal")).toBe("personal");
  });
  it("非空间路由无 ambient → null（现状）", () => {
    expect(selectedSpaceKey("/about", slugs)).toBeNull();
  });
  it("空间路由忽略 ambient（pathname 为准）", () => {
    expect(selectedSpaceKey("/space/lab/dashboard", slugs, "growthx")).toBe("lab");
  });
});

