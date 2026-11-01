import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import zh from "@/i18n/messages/zh.json";

import type { NotificationListItem } from "../queries";
import { createTranslator, type TranslateFn } from "@/i18n/translate";
import { formatNotificationBody, parseBoldSegments } from "./notification-format";

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

/** notifications 命名空间的轻量 translator（与 NotificationBell 的取词口径一致）。 */
const tZh: TranslateFn = createTranslator(zh.notifications);
const tEn: TranslateFn = createTranslator(en.notifications);

describe("parseBoldSegments", () => {
  it("开头加粗：`<b>重点</b>文本`", () => {
    expect(parseBoldSegments("<b>重点</b>文本")).toEqual([
      { text: "重点", bold: true },
      { text: "文本", bold: false },
    ]);
  });

  it("结尾加粗：`加粗<b>重点</b>`", () => {
    expect(parseBoldSegments("加粗<b>重点</b>")).toEqual([
      { text: "加粗", bold: false },
      { text: "重点", bold: true },
    ]);
  });

  it("连续加粗标签之间不产生空片段", () => {
    expect(parseBoldSegments("前<b>a</b><b>b</b>后")).toEqual([
      { text: "前", bold: false },
      { text: "a", bold: true },
      { text: "b", bold: true },
      { text: "后", bold: false },
    ]);
  });

  it("无标记文本整体为普通片段", () => {
    expect(parseBoldSegments("普通文本")).toEqual([
      { text: "普通文本", bold: false },
    ]);
  });
});

describe("formatNotificationBody（zh，与迁移前逐字一致）", () => {
  it("team_invite：触发者粗体 + 邀请加入团队", () => {
    expect(formatNotificationBody(makeItem({ type: "team_invite" }), tZh)).toEqual({
      parts: [
        { text: "何川", bold: true },
        { text: " 邀请你加入团队「效率工程部」", bold: false },
      ],
    });
  });

  it("task_assigned：触发者粗体 + 指派任务", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_assigned", actorName: "周牧" }), tZh),
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
        tZh,
      ),
    ).toEqual({
      parts: [{ text: "你负责的「上线落地页」今日/明日到期", bold: false }],
    });
  });

  it("task_overdue：仅「已逾期」粗体", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_overdue", actorName: null }), tZh),
    ).toEqual({
      parts: [
        { text: "你负责的「上线落地页」", bold: false },
        { text: "已逾期", bold: true },
      ],
    });
  });

  it("task_commented：触发者粗体 + 评论任务", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_commented", actorName: "苏晓" }), tZh),
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
        tZh,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: " 更新了你负责的「上线落地页」", bold: false },
      ],
    });
  });

  it("team_join_requested：触发者粗体 + 申请加入团队", () => {
    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_requested",
          actorName: "周牧",
          teamName: "增长突击队",
        }),
        tZh,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: " 申请加入团队「增长突击队」", bold: false },
      ],
    });
  });

  it("team_join_approved：触发者粗体 + 通过加入申请", () => {
    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_approved",
          actorName: "周牧",
          teamName: "增长突击队",
        }),
        tZh,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: " 通过了你加入「增长突击队」的申请", bold: false },
      ],
    });
  });

  it("team_join_declined：触发者粗体 + 拒绝加入申请", () => {
    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_declined",
          actorName: "周牧",
          teamName: "增长突击队",
        }),
        tZh,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: " 拒绝了你加入「增长突击队」的申请", bold: false },
      ],
    });
  });

  it("actorName=null 时去掉触发者主体（cron 通知）", () => {
    expect(
      formatNotificationBody(makeItem({ type: "team_invite", actorName: null }), tZh),
    ).toEqual({
      parts: [{ text: "邀请你加入团队「效率工程部」", bold: false }],
    });

    expect(
      formatNotificationBody(makeItem({ type: "task_assigned", actorName: null }), tZh),
    ).toEqual({
      parts: [{ text: "把「上线落地页」指派给你", bold: false }],
    });

    expect(
      formatNotificationBody(makeItem({ type: "task_commented", actorName: null }), tZh),
    ).toEqual({
      parts: [{ text: "评论了「上线落地页」", bold: false }],
    });

    expect(
      formatNotificationBody(
        makeItem({ type: "task_changed_by_admin", actorName: null }),
        tZh,
      ),
    ).toEqual({
      parts: [{ text: "更新了你负责的「上线落地页」", bold: false }],
    });

    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_requested",
          actorName: null,
          teamName: "增长突击队",
        }),
        tZh,
      ),
    ).toEqual({
      parts: [{ text: "申请加入团队「增长突击队」", bold: false }],
    });

    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_approved",
          actorName: null,
          teamName: "增长突击队",
        }),
        tZh,
      ),
    ).toEqual({
      parts: [{ text: "通过了你加入「增长突击队」的申请", bold: false }],
    });

    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_declined",
          actorName: null,
          teamName: "增长突击队",
        }),
        tZh,
      ),
    ).toEqual({
      parts: [{ text: "拒绝了你加入「增长突击队」的申请", bold: false }],
    });
  });

  it("task_overdue 忽略 actor（文案固定为你负责的…）", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_overdue", actorName: "周牧" }), tZh),
    ).toEqual({
      parts: [
        { text: "你负责的「上线落地页」", bold: false },
        { text: "已逾期", bold: true },
      ],
    });
  });

  it("taskTitle/teamName 缺失时使用占位文案", () => {
    expect(
      formatNotificationBody(
        makeItem({ type: "task_assigned", actorName: null, taskTitle: null }),
        tZh,
      ),
    ).toEqual({ parts: [{ text: "把「未知任务」指派给你", bold: false }] });

    expect(
      formatNotificationBody(
        makeItem({ type: "team_invite", actorName: null, teamName: null }),
        tZh,
      ),
    ).toEqual({ parts: [{ text: "邀请你加入团队「未知团队」", bold: false }] });
  });
});

describe("formatNotificationBody（en）", () => {
  it("team_invite：触发者粗体在前，宾语按英文语序", () => {
    expect(formatNotificationBody(makeItem({ type: "team_invite" }), tEn)).toEqual({
      parts: [
        { text: "何川", bold: true },
        { text: ' invited you to join team "效率工程部"', bold: false },
      ],
    });
  });

  it("task_assigned：指派语序调整为 assigned … to you", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_assigned", actorName: "周牧" }), tEn),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: ' assigned "上线落地页" to you', bold: false },
      ],
    });
  });

  it("task_due_soon：任务名前置的英文陈述句", () => {
    expect(
      formatNotificationBody(
        makeItem({ type: "task_due_soon", actorName: null }),
        tEn,
      ),
    ).toEqual({
      parts: [{ text: '"上线落地页" (assigned to you) is due today/tomorrow', bold: false }],
    });
  });

  it("task_overdue：仅 overdue 粗体", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_overdue", actorName: null }), tEn),
    ).toEqual({
      parts: [
        { text: '"上线落地页" (assigned to you) is ', bold: false },
        { text: "overdue", bold: true },
      ],
    });
  });

  it("task_commented / task_changed_by_admin / join 系列", () => {
    expect(
      formatNotificationBody(makeItem({ type: "task_commented", actorName: "苏晓" }), tEn),
    ).toEqual({
      parts: [
        { text: "苏晓", bold: true },
        { text: ' commented on "上线落地页"', bold: false },
      ],
    });

    expect(
      formatNotificationBody(
        makeItem({ type: "task_changed_by_admin", actorName: "周牧" }),
        tEn,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: ' updated "上线落地页" (assigned to you)', bold: false },
      ],
    });

    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_requested",
          actorName: "周牧",
          teamName: "增长突击队",
        }),
        tEn,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: ' requested to join team "增长突击队"', bold: false },
      ],
    });

    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_approved",
          actorName: "周牧",
          teamName: "增长突击队",
        }),
        tEn,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: ' approved your request to join "增长突击队"', bold: false },
      ],
    });

    expect(
      formatNotificationBody(
        makeItem({
          type: "team_join_declined",
          actorName: "周牧",
          teamName: "增长突击队",
        }),
        tEn,
      ),
    ).toEqual({
      parts: [
        { text: "周牧", bold: true },
        { text: ' declined your request to join "增长突击队"', bold: false },
      ],
    });
  });

  it("actorName=null 时去掉触发者主体", () => {
    expect(
      formatNotificationBody(makeItem({ type: "team_invite", actorName: null }), tEn),
    ).toEqual({
      parts: [{ text: 'invited you to join team "效率工程部"', bold: false }],
    });
  });

  it("未知类型不渲染任何片段", () => {
    expect(
      formatNotificationBody(
        makeItem({ type: "system_broadcast" as NotificationListItem["type"] }),
        tEn,
      ),
    ).toEqual({ parts: [] });
  });
});
