import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import zh from "@/i18n/messages/zh.json";

import {
  SPACE_GROUP_LABELS,
  selectedSpaceKey,
  splitTeamsByKind,
} from "./SpaceSwitcher";

const realTeam = { slug: "growth", name: "增长突击队", kind: "real" as const };
const virtualTeam = { slug: "agents", name: "Agent 小队", kind: "virtual" as const };

describe("splitTeamsByKind", () => {
  it("真实/虚拟团队分两组并保持服务端返回顺序", () => {
    const secondReal = { slug: "ops", name: "运营组", kind: "real" as const };

    expect(
      splitTeamsByKind([realTeam, virtualTeam, secondReal]),
    ).toEqual({ real: [realTeam, secondReal], virtual: [virtualTeam] });
  });

  it("没有虚拟团队时 virtual 为空数组（组件据此不渲染分组标题）", () => {
    expect(splitTeamsByKind([realTeam]).virtual).toEqual([]);
  });

  it("全部是虚拟团队时 real 为空数组", () => {
    expect(splitTeamsByKind([virtualTeam]).real).toEqual([]);
  });

  it("空列表两组皆空", () => {
    expect(splitTeamsByKind([])).toEqual({ real: [], virtual: [] });
  });

  it("分组标题 key 在 zh/en 目录中都存在", () => {
    expect(zh.nav).toHaveProperty(SPACE_GROUP_LABELS.real);
    expect(zh.nav).toHaveProperty(SPACE_GROUP_LABELS.virtual);
    expect(en.nav).toHaveProperty(SPACE_GROUP_LABELS.real);
    expect(en.nav).toHaveProperty(SPACE_GROUP_LABELS.virtual);
  });
});

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

  it("虚拟团队与其他团队一样按 slug 命中（选中逻辑不区分 kind）", () => {
    expect(selectedSpaceKey("/space/agents/dashboard", ["growth", "agents"])).toBe(
      "agents",
    );
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
