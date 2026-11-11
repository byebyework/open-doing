import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";
import type { TeamRole } from "@/features/teams/permissions";

import type { TeamTaskRow } from "../service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { TeamKanban } = await import("./TeamKanban");

const ASSIGNEE_ID = "33333333-3333-3333-3333-333333333333";
const OWNER_ID = "44444444-4444-4444-4444-444444444444";

function makeTask(overrides: Partial<TeamTaskRow> = {}): TeamTaskRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    spaceType: "team",
    title: "首页视觉稿评审",
    status: "todo",
    priority: "medium",
    assigneeId: ASSIGNEE_ID,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    subtasks: [],
    assigneeName: "member_smoke",
    ...overrides,
  };
}

/**
 * 服务端渲染时 `useIsDesktop` 取 server snapshot（窄屏），正好覆盖
 * 「移动端降级为状态按钮」这条路径。
 */
function render(role: TeamRole, task: TeamTaskRow): string {
  return renderToStaticMarkup(
    // NextIntlClientProvider 的类型把 children 定为必填 props，无法用
    // createElement 第三参传递；此处 children-prop 写法是必需的。
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: "zh",
      messages: zh,
      now: new Date("2026-10-23T00:00:00.000Z"),
      children: createElement(TeamKanban, {
        teamId: "55555555-5555-5555-5555-555555555555",
        teamSlug: "smoke-squad",
        tasks: [task],
        members: [
          { id: ASSIGNEE_ID, name: "member_smoke" },
          { id: OWNER_ID, name: "owner_smoke" },
        ],
        today: "2026-10-23",
        projectId: "22222222-2222-2222-2222-222222222222",
        projects: [{ id: "22222222-2222-2222-2222-222222222222", name: "官网改版" }],
        role,
        actorId: OWNER_ID,
        projectSlug: "project",
      }),
    }),
  );
}

/** 取出包含指定文案的状态按钮（`split` 后每段以按钮属性开头）。 */
function statusButton(html: string, label: string): string {
  const segment = html
    .split("<button")
    .find((part) => part.includes(`>${label}</button>`));

  if (!segment) throw new Error(`未渲染状态按钮：${label}`);
  return segment;
}

describe("TeamKanban 移动端状态按钮", () => {
  it("owner 在窄屏也能通过状态按钮改他人任务的状态", () => {
    const html = render("owner", makeTask());
    const button = statusButton(html, "进行中");

    // 钉 disabled 属性而非 /disabled/ 子串：shadcn Button 的 class 字面量
    // 含 "disabled:*" 工具类（同 TaskDetailView.test 判例）。
    expect(button).not.toContain('disabled=""');
  });

  it("member 对他人任务的状态按钮保持禁用", () => {
    const html = render("member", makeTask());
    const button = statusButton(html, "进行中");

    expect(button).toContain('disabled=""');
  });
});

describe("TeamKanban 优先级色点", () => {
  it("卡片渲染优先级色点（title 显示档位）", () => {
    const html = render("owner", makeTask({ priority: "high" }));

    expect(html).toContain('data-testid="priority-dot"');
    expect(html).toContain('data-priority="high"');
  });
});
