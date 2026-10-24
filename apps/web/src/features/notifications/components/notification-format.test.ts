import { describe, expect, it } from "vitest";

import type { NotificationListItem } from "../queries";
import { formatNotificationBody } from "./notification-format";

/** 构造通知列表项；只覆盖文案关心的字段。 */
function makeItem(overrides: Partial<NotificationListItem> = {}): NotificationListItem {
  return {
    id: "notification-1",
    type: "team_invite",
    read: false,
    createdAt: "2026-10-24T00:00:00.000Z",
    actorName: "何川",
    teamName: "效率工程部",
    taskTitle: "上线落地页",
    href: null,
    ...overrides,
  };
}

describe("formatNotificationBody", () => {
  it("team_invite：触发者粗体 + 邀请加入团队", () => {
    expect(formatNotificationBody(makeItem({ type: "team_invite" }))).toEqual({
      parts: [
        { text: "何川", bold: true },
        { text: " 邀请你加入团队「效率工程部」", bold: false },
      ],
    });
  });

  it("task_assigned：触发者粗体 + 指派任务", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_assigned", actorName: "周牧" })),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: " 把「上线落地页」指派给你", bold: false },
      ],
    });
  });

  it("task_due_soon：无触发者的陈述句", () => {
    expect(
      formatNotificationBody(
        makeItem({ type: "task_due_soon", actorName: null }),
      ),
    ).toEqual({
      parts: [{ text: "你负责的「上线落地页」今日/明日到期", bold: false }],
    });
  });

  it("task_overdue：仅「已逾期」粗体", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_overdue", actorName: null })),
    ).toEqual({
      parts: [
        { text: "你负责的「上线落地页」", bold: false },
        { text: "已逾期", bold: true },
      ],
    });
  });

  it("task_commented：触发者粗体 + 评论任务", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_commented", actorName: "苏晓" })),
    ).toEqual({
      parts: [
        { text: "苏晓", bold: true },
        { text: " 评论了「上线落地页」", bold: false },
      ],
    });
  });

  it("task_changed_by_admin：触发者粗体 + 管理员更新任务", () => {
    expect(
      formatNotificationBody(
        makeItem({ type: "task_changed_by_admin", actorName: "周牧" }),
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: " 更新了你负责的「上线落地页」", bold: false },
      ],
    });
  });

  it("actorName=null 时去掉触发者主体（cron 通知）", () => {
    expect(
      formatNotificationBody(makeItem({ type: "team_invite", actorName: null })),
    ).toEqual({
      parts: [{ text: "邀请你加入团队「效率工程部」", bold: false }],
    });

    expect(
      formatNotificationBody(makeItem({ type: "task_assigned", actorName: null })),
    ).toEqual({
      parts: [{ text: "把「上线落地页」指派给你", bold: false }],
    });

    expect(
      formatNotificationBody(makeItem({ type: "task_commented", actorName: null })),
    ).toEqual({
      parts: [{ text: "评论了「上线落地页」", bold: false }],
    });

    expect(
      formatNotificationBody(
        makeItem({ type: "task_changed_by_admin", actorName: null }),
      ),
    ).toEqual({
      parts: [{ text: "更新了你负责的「上线落地页」", bold: false }],
    });
  });

  it("task_overdue 忽略 actor（文案固定为你负责的…）", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_overdue", actorName: "周牧" })),
    ).toEqual({
      parts: [
        { text: "你负责的「上线落地页」", bold: false },
        { text: "已逾期", bold: true },
      ],
    });
  });
});
