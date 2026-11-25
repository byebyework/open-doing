/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { addProjectCommentAction, deleteProjectCommentAction } from "../actions";
import type { TimelineItem } from "../activities";
import { ProjectTimeline } from "./ProjectTimeline";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    addProjectCommentAction: vi.fn(),
    deleteProjectCommentAction: vi.fn(),
  };
});

const mockAdd = vi.mocked(addProjectCommentAction);
const mockDelete = vi.mocked(deleteProjectCommentAction);

/** jsdom 探针：动态行文案（status 走 i18n 标签而非 key）、评论作者删除入口、发表评论。 */
describe("ProjectTimeline", () => {
  let container: HTMLDivElement;
  let root: Root;

  const activityItem: TimelineItem = {
    kind: "activity",
    id: "a1",
    type: "status",
    payload: { kind: "scalar", from: "backlog", to: "in_progress" },
    createdAt: "2026-11-24T02:00:00.000Z",
    actor: { id: "u1", name: "林夏" },
  };

  const ownComment: TimelineItem = {
    kind: "comment",
    id: "c1",
    content: "自己的评论",
    createdAt: "2026-11-24T03:00:00.000Z",
    author: { id: "u1", name: "林夏" },
    replies: [],
  };

  const otherComment: TimelineItem = {
    kind: "comment",
    id: "c2",
    content: "别人的评论",
    createdAt: "2026-11-24T01:00:00.000Z",
    author: { id: "u2", name: "阿测" },
    replies: [],
  };

  beforeEach(() => {
    refresh.mockReset();
    mockAdd.mockReset();
    mockDelete.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(items: TimelineItem[]) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectTimeline
            projectId="p1"
            items={items}
            currentUserId="u1"
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("状态动态渲染 i18n 标签而非存储 key，演员名在前", () => {
    render([activityItem]);

    const text = container.textContent ?? "";
    expect(text).toContain("林夏");
    expect(text).toContain("将状态从");
    expect(text).toContain("待办");
    expect(text).toContain("进行中");
    expect(text).not.toContain("backlog");
    expect(text).not.toContain("in_progress");
  });

  it("评论渲染内容；仅本人评论显示删除入口", () => {
    render([ownComment, otherComment]);

    expect(container.textContent).toContain("自己的评论");
    expect(container.textContent).toContain("别人的评论");

    const buttons = Array.from(container.querySelectorAll("button"));
    const deleteButtons = buttons.filter((b) => b.textContent?.includes("删除"));
    expect(deleteButtons).toHaveLength(1);
  });

  it("发表评论调用 addProjectCommentAction 并刷新", async () => {
    mockAdd.mockResolvedValue({
      ok: true,
      data: {
        id: "c9",
        projectId: "p1",
        authorId: "u1",
        authorName: "林夏",
        content: "新评论",
        createdAt: "2026-11-24T04:00:00.000Z",
      },
    });
    render([]);

    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, "新评论");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const post = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("发表评论"),
    )!;
    await act(async () => {
      post.click();
    });

    expect(mockAdd).toHaveBeenCalledWith({ projectId: "p1", content: "新评论" });
    expect(refresh).toHaveBeenCalled();
  });

  it("删除评论调用 deleteProjectCommentAction 并刷新", async () => {
    mockDelete.mockResolvedValue({ ok: true, data: true });
    render([ownComment]);

    const del = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("删除"),
    )!;
    await act(async () => {
      del.click();
    });

    expect(mockDelete).toHaveBeenCalledWith({ projectId: "p1", commentId: "c1" });
    expect(refresh).toHaveBeenCalled();
  });

  it("主输入框 rows=6", () => {
    render([]);
    expect(container.querySelector("textarea")?.getAttribute("rows")).toBe("6");
  });

  it("线程默认收起：pill 计数可见、回复列表不在 DOM；点 pill 展开后回复与底部输入框出现", async () => {
    const rootWithReplies: TimelineItem = {
      kind: "comment",
      id: "c1",
      content: "根评论",
      createdAt: "2026-11-24T03:00:00.000Z",
      author: { id: "u1", name: "林夏" },
      replies: [
        {
          id: "r1",
          content: "已有的回复",
          createdAt: "2026-11-24T03:30:00.000Z",
          author: { id: "u2", name: "阿测" },
        },
      ],
    };
    render([rootWithReplies]);

    const toggle = container.querySelector<HTMLElement>(
      '[data-testid="thread-replies-toggle"]',
    );
    expect(toggle, "missing thread toggle").not.toBeNull();
    expect(toggle!.textContent).toContain("1 条回复");
    // 默认收起：回复列表与回复输入框都不在 DOM。
    expect(container.textContent).not.toContain("已有的回复");
    expect(container.querySelector("ul textarea")).toBeNull();

    await act(async () => {
      toggle!.click();
    });
    expect(container.textContent).toContain("已有的回复");
    const textarea = container.querySelector("ul textarea")!;
    expect(textarea.getAttribute("rows")).toBe("6");
    expect(textarea.getAttribute("aria-label")).toBe("回复内容");
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");

    // 再点收起：回复列表消失。
    await act(async () => {
      toggle!.click();
    });
    expect(container.textContent).not.toContain("已有的回复");
    expect(container.querySelector("ul textarea")).toBeNull();
  });

  it("0 回复根评论：pill 文案「回复」，展开只有输入框", async () => {
    const rootNoReplies: TimelineItem = {
      kind: "comment",
      id: "c1",
      content: "孤根评论",
      createdAt: "2026-11-24T03:00:00.000Z",
      author: { id: "u1", name: "林夏" },
      replies: [],
    };
    render([rootNoReplies]);

    const toggle = container.querySelector<HTMLElement>(
      '[data-testid="thread-replies-toggle"]',
    )!;
    expect(toggle.textContent).toContain("回复");
    expect(toggle.textContent).not.toContain("条回复");

    await act(async () => {
      toggle.click();
    });
    expect(container.querySelector("ul textarea")).not.toBeNull();
    // 没有回复行（只有输入框）。
    expect(container.textContent).not.toContain("孤根评论的回复");
  });

  it("展开状态下提交回复带根 parentId；数据刷新后仍展开且计数更新", async () => {
    mockAdd.mockResolvedValue({
      ok: true,
      data: {
        id: "r9",
        projectId: "p1",
        authorId: "u1",
        authorName: "林夏",
        content: "回复内容2",
        createdAt: "2026-11-24T05:00:00.000Z",
      },
    });
    const oneReply: TimelineItem = {
      kind: "comment",
      id: "c1",
      content: "根评论",
      createdAt: "2026-11-24T03:00:00.000Z",
      author: { id: "u1", name: "林夏" },
      replies: [
        {
          id: "r1",
          content: "已有的回复",
          createdAt: "2026-11-24T03:30:00.000Z",
          author: { id: "u2", name: "阿测" },
        },
      ],
    };
    render([oneReply]);

    const toggle = container.querySelector<HTMLElement>(
      '[data-testid="thread-replies-toggle"]',
    )!;
    await act(async () => {
      toggle.click();
    });

    const list = container.querySelector("ul")!;
    const replyTextarea = list.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(replyTextarea, "回复内容2");
    replyTextarea.dispatchEvent(new Event("input", { bubbles: true }));

    const replyPost = Array.from(list.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("发表评论"),
    )!;
    await act(async () => {
      replyPost.click();
    });

    expect(mockAdd).toHaveBeenCalledWith({
      projectId: "p1",
      content: "回复内容2",
      parentId: "c1",
    });
    expect(refresh).toHaveBeenCalled();

    // 模拟 refresh：同组件挂载下带2 条回复重渲染 → 仍展开、计数更新。
    const twoReplies: TimelineItem = {
      ...(oneReply as Extract<TimelineItem, { kind: "comment" }>),
      replies: [
        ...(oneReply as Extract<TimelineItem, { kind: "comment" }>).replies,
        {
          id: "r2",
          content: "第二条回复",
          createdAt: "2026-11-24T05:01:00.000Z",
          author: { id: "u1", name: "林夏" },
        },
      ],
    };
    render([twoReplies]);
    expect(
      container.querySelector('[data-testid="thread-replies-toggle"]')!
        .textContent,
    ).toContain("2 条回复");
    expect(container.querySelector("ul textarea")).not.toBeNull();
  });

  it("回复行仅作者可删；非作者回复无删除入口（先展开）", async () => {
    const rootWithReplies: TimelineItem = {
      kind: "comment",
      id: "c1",
      content: "根评论",
      createdAt: "2026-11-24T03:00:00.000Z",
      author: { id: "u1", name: "林夏" },
      replies: [
        {
          id: "r1",
          content: "别人的回复",
          createdAt: "2026-11-24T03:30:00.000Z",
          author: { id: "u2", name: "阿测" },
        },
        {
          id: "r2",
          content: "自己的回复",
          createdAt: "2026-11-24T03:40:00.000Z",
          author: { id: "u1", name: "林夏" },
        },
      ],
    };
    render([rootWithReplies]);

    const deleteButtons = () =>
      Array.from(container.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("删除"),
      );
    // 收起：只有根评论（作者 u1）的删除。
    expect(deleteButtons()).toHaveLength(1);

    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-testid="thread-replies-toggle"]')!
        .click();
    });
    // 展开：根 + 自己的回复有删除；别人的回复没有 → 共2。
    expect(deleteButtons()).toHaveLength(2);
  });
});
