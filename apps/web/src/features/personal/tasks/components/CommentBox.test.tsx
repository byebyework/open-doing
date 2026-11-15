import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import zh from "@/i18n/messages/zh.json";

import type { CommentBoxItem } from "./CommentBox";

import { CommentBox } from "./CommentBox";

const CURRENT_USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const VIRTUAL_ID = "33333333-3333-3333-3333-333333333333";

const comments: CommentBoxItem[] = [
  {
    id: "comment-own",
    authorId: CURRENT_USER_ID,
    authorVirtualId: null,
    authorName: "我自己",
    authorAccentColor: null,
    content: "这是本人的评论",
    createdAt: "2026-10-01T01:00:00.000Z",
  },
  {
    id: "comment-other",
    authorId: OTHER_USER_ID,
    authorVirtualId: null,
    authorName: "其他成员",
    authorAccentColor: null,
    content: "这是他人评论",
    createdAt: "2026-10-01T02:00:00.000Z",
  },
  {
    id: "comment-virtual",
    authorId: null,
    authorVirtualId: VIRTUAL_ID,
    authorName: "写作助手",
    authorAccentColor: "#a66b00",
    content: "这是虚拟成员评论",
    createdAt: "2026-10-01T03:00:00.000Z",
  },
  {
    id: "comment-unsigned",
    authorId: null,
    authorVirtualId: null,
    authorName: null,
    authorAccentColor: null,
    content: "这是被移除成员的评论",
    createdAt: "2026-10-01T04:00:00.000Z",
  },
];

function render(canModerateVirtualComments?: boolean): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="zh"
      messages={zh}
      now={new Date("2026-10-01T00:00:00.000Z")}
    >
      <CommentBox
        comments={comments}
        currentUserId={CURRENT_USER_ID}
        onAdd={async () => {}}
        onDelete={async () => {}}
        canModerateVirtualComments={canModerateVirtualComments}
      />
    </NextIntlClientProvider>,
  );
}

/** 删除入口数量（按钮文案取 common.delete）。 */
function deleteEntryCount(html: string): number {
  return (html.match(/删除/g) ?? []).length;
}

describe("CommentBox 作者多态渲染", () => {
  it("虚拟作者：首字符 + authorAccentColor 底色 + 机器人角标", () => {
    const html = render();

    expect(html).toContain("写作助手");
    expect(html).toContain("background-color:#a66b00");
    expect(html).toContain('data-testid="assignee-avatar-bot-badge"');
    expect(html).toContain('aria-label="虚拟成员"');
  });

  it("无署名（虚拟成员被移除）：展示「已移除成员」占位", () => {
    const html = render();
    const block = html
      .split('<div class="group flex gap-3">')
      .find((part) => part.includes('aria-label="已移除成员"'));

    expect(html).toContain("已移除成员");
    expect(block).toBeDefined();
    expect(block).not.toContain('data-testid="assignee-avatar-bot-badge"');
  });
});

describe("CommentBox 删除入口权限", () => {
  it("普通团队：只给本人评论删除入口", () => {
    expect(deleteEntryCount(render())).toBe(1);
  });

  it("虚拟团队 owner/admin：本人 + 虚拟作者 + 无署名评论都可代管删除", () => {
    // 本人（1）+ 虚拟作者（1）+ 被移除成员的无署名评论（1）。
    expect(deleteEntryCount(render(true))).toBe(3);
  });

  it("真人他人评论即便开启虚拟代管也不显示删除入口", () => {
    const html = render(true);
    const block = html
      .split('<div class="group flex gap-3">')
      .find((part) => part.includes('aria-label="其他成员"'));

    expect(block).toBeDefined();
    expect(block).not.toContain("删除");
  });
});
