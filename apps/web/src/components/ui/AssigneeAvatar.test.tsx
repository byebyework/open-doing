import type { AssigneeRef } from "@open-doing/types";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import zh from "@/i18n/messages/zh.json";

import { AssigneeAvatar } from "./AssigneeAvatar";
import { avatarColor } from "./UserAvatar";

function render(assigneeRef: AssigneeRef | null, size?: "sm" | "md"): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="zh"
      messages={zh}
      now={new Date("2026-10-01T00:00:00.000Z")}
    >
      <AssigneeAvatar assigneeRef={assigneeRef} size={size} />
    </NextIntlClientProvider>,
  );
}

/** 内联 background-color（React SSR 输出 `background-color:#xxxxxx`）。 */
function backgroundColor(html: string): string {
  const match = /background-color:([^;"]+)/.exec(html);
  if (!match) throw new Error(`未渲染 background-color：${html}`);
  return match[1]!;
}

const virtualRef: AssigneeRef = {
  type: "virtual",
  virtualMemberId: "vm-1",
  name: "写作助手",
  accentColor: "#a66b00",
};

describe("AssigneeAvatar：虚拟成员", () => {
  it("渲染首字符 + accentColor 底色 + 机器人角标（角标带 aria-label）", () => {
    const html = render(virtualRef);

    expect(html).toContain(">写<");
    expect(backgroundColor(html)).toBe("#a66b00");
    expect(html).toContain('data-testid="assignee-avatar-bot-badge"');
    expect(html).toContain('aria-label="虚拟成员"');
    expect(html).toContain('aria-label="写作助手"');
  });

  it("accentColor 为空时回退到虚拟成员默认色，不按 name 哈希", () => {
    const html = render({ ...virtualRef, accentColor: null });

    expect(backgroundColor(html)).toBe("#a66b00");
  });

  it("角标随尺寸缩放：sm 默认隐藏文字只保留图标", () => {
    const html = render(virtualRef, "sm");

    expect(html).toContain(">写<");
    expect(html).not.toContain(">写作助手<");
  });
});

describe("AssigneeAvatar：未指派", () => {
  it("ref 为 null 时渲染未指派占位（aria-label 取 tasks.unassigned）", () => {
    const html = render(null);

    expect(html).toContain('aria-label="未指派"');
    expect(html).not.toContain('data-testid="assignee-avatar-bot-badge"');
  });
});

describe("AssigneeAvatar：真人成员", () => {
  it("复用 UserAvatar 的首字 + userId 哈希底色，不渲染机器人角标", () => {
    const html = render({
      type: "user",
      userId: "user-a",
      name: "林夏",
      image: null,
    });

    expect(html).toContain(">林<");
    expect(backgroundColor(html)).toBe(avatarColor("user-a"));
    expect(html).toContain('aria-label="林夏"');
    expect(html).not.toContain('data-testid="assignee-avatar-bot-badge"');
  });
});
