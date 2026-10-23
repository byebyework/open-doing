import { describe, expect, it } from "vitest";

import {
  assigneeCalloutText,
  shouldShowAssigneeCallout,
} from "./callout";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("shouldShowAssigneeCallout", () => {
  it("团队态当前用户就是责任人时显示", () => {
    expect(
      shouldShowAssigneeCallout({
        space: "team",
        currentUserId: ME,
        assigneeId: ME,
        canEdit: true,
      }),
    ).toBe(true);
  });

  it("团队态当前用户不是责任人时隐藏（即使拥有改派权限）", () => {
    // 旧实现用 canAssign 判断，owner/admin 会看到「你是此任务的责任人」。
    expect(
      shouldShowAssigneeCallout({
        space: "team",
        currentUserId: ME,
        assigneeId: OTHER,
        canEdit: true,
      }),
    ).toBe(false);
  });

  it("团队态缺少当前用户时不显示身份断言", () => {
    expect(
      shouldShowAssigneeCallout({
        space: "team",
        currentUserId: undefined,
        assigneeId: ME,
        canEdit: true,
      }),
    ).toBe(false);
  });

  it("团队态任务未指派时不显示", () => {
    expect(
      shouldShowAssigneeCallout({
        space: "team",
        currentUserId: ME,
        assigneeId: null,
        canEdit: true,
      }),
    ).toBe(false);
  });

  it("个人态永不显示团队语境 callout", () => {
    expect(
      shouldShowAssigneeCallout({
        space: "personal",
        currentUserId: ME,
        assigneeId: ME,
        canEdit: true,
      }),
    ).toBe(false);
  });
});

describe("assigneeCalloutText", () => {
  it("可编辑时包含编辑说明", () => {
    expect(assigneeCalloutText(true)).toBe(
      "你是此任务的责任人，可以编辑任务内容；团队所有成员都可以发表评论。",
    );
  });

  it("不可编辑时不宣称可以编辑", () => {
    const text = assigneeCalloutText(false);
    expect(text).toBe(
      "你是此任务的责任人；团队所有成员都可以发表评论。",
    );
    expect(text).not.toContain("可以编辑");
  });
});
