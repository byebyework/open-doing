import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";

import type { TeamKanbanCardItem, TeamSpaceBoard } from "../service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const { SpaceKanban } = await import("./SpaceKanban");

const TEAM_ID = "55555555-5555-5555-5555-555555555555";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";

function makeCard(
  overrides: Partial<TeamKanbanCardItem>,
): TeamKanbanCardItem {
  return {
    id: crypto.randomUUID(),
    title: "任务",
    status: "todo",
    priority: "medium",
    dueDate: null,
    projectId: PROJECT_ID,
    projectName: "官网改版",
    subtaskTotal: 0,
    subtaskDone: 0,
    completedAt: null,
    assigneeId: null,
    assigneeName: null,
    assigneeRef: null,
    ...overrides,
  };
}

function renderCard(card: TeamKanbanCardItem): string {
  const board: TeamSpaceBoard = {
    todo: [card],
    inProgress: [],
    doneRecent: [],
    doneOlderCount: 0,
    doneTotal: 0,
  };

  return renderToStaticMarkup(
    // NextIntlClientProvider 的类型把 children 定为必填 props，无法用
    // createElement 第三参传递；此处 children-prop 写法是必需的。
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: "zh",
      messages: zh,
      now: new Date("2026-10-23T00:00:00.000Z"),
      children: createElement(SpaceKanban, {
        variant: "team",
        board,
        projects: [{ id: PROJECT_ID, name: "官网改版", slug: "project" }],
        today: "2026-10-23",
        teamId: TEAM_ID,
        teamSlug: "smoke-squad",
        role: "owner",
        actorId: "44444444-4444-4444-4444-444444444444",
        taskHrefs: {},
      }),
    }),
  );
}

describe("SpaceKanban 卡片责任人（assigneeRef）", () => {
  it("虚拟成员：使用 accentColor 头像并带机器人角标", () => {
    const html = renderCard(
      makeCard({
        assigneeName: "写作助手",
        assigneeRef: {
          type: "virtual",
          virtualMemberId: "66666666-6666-6666-6666-666666666666",
          name: "写作助手",
          accentColor: "#a66b00",
        },
      }),
    );

    expect(html).toContain("写作助手");
    expect(html).toContain('data-testid="assignee-avatar-bot-badge"');
    expect(html).toContain('aria-label="虚拟成员"');
    expect(html).toContain("background-color:#a66b00");
  });

  it("真人成员：复用 userId 哈希头像（无机器人角标）", () => {
    const USER_ID = "33333333-3333-3333-3333-333333333333";
    const html = renderCard(
      makeCard({
        assigneeId: USER_ID,
        assigneeName: "林夏",
        assigneeRef: {
          type: "user",
          userId: USER_ID,
          name: "林夏",
          image: null,
        },
      }),
    );

    expect(html).toContain("林夏");
    expect(html).not.toContain('data-testid="assignee-avatar-bot-badge"');
  });

  it("未指派：显示未指派文案且无头像角标", () => {
    const html = renderCard(makeCard({ assigneeRef: null }));

    expect(html).toContain(zh.tasks.unassigned);
    expect(html).not.toContain('data-testid="assignee-avatar-bot-badge"');
  });
});
