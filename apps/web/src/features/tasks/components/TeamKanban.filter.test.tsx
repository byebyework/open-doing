/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamRole } from "@/features/teams/permissions";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import type { TeamTaskRow } from "../service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const { TeamKanban } = await import("./TeamKanban");

const TEAM_ID = "55555555-5555-5555-5555-555555555555";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const REAL_ID = "33333333-3333-3333-3333-333333333333";
const VIRTUAL_ID = "66666666-6666-6666-6666-666666666666";
const OWNER_ID = "44444444-4444-4444-4444-444444444444";

const REAL_TITLE = "真人任务";
const VIRTUAL_TITLE = "虚拟任务";
const UNASSIGNED_TITLE = "未指派任务";

function makeTask(overrides: Partial<TeamTaskRow>): TeamTaskRow {
  return {
    id: crypto.randomUUID(),
    projectId: PROJECT_ID,
    spaceType: "team",
    title: "任务",
    status: "todo",
    priority: "medium",
    assigneeId: null,
    assigneeVirtualId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    subtasks: [],
    assigneeName: null,
    assigneeRef: null,
    ...overrides,
  };
}

const tasks: TeamTaskRow[] = [
  makeTask({
    title: REAL_TITLE,
    assigneeId: REAL_ID,
    assigneeName: "林夏",
    assigneeRef: {
      type: "user",
      userId: REAL_ID,
      name: "林夏",
      image: null,
    },
  }),
  makeTask({
    title: VIRTUAL_TITLE,
    assigneeVirtualId: VIRTUAL_ID,
    assigneeName: "写作助手",
    assigneeRef: {
      type: "virtual",
      virtualMemberId: VIRTUAL_ID,
      name: "写作助手",
      accentColor: "#a66b00",
    },
  }),
  makeTask({ title: UNASSIGNED_TITLE }),
];

const members = [{ id: REAL_ID, name: "林夏" }];
const virtualMembers = [
  { id: VIRTUAL_ID, name: "写作助手", accentColor: "#a66b00" },
];

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * 责任人筛选的三条匹配分支（真人 / 虚拟成员 / 未指派）都按 assigneeRef
 * 判定；沿用 popover.test.tsx 的 Radix Select 点选探针。
 */
describe("TeamKanban 责任人筛选（assigneeRef 匹配）", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
  let originalHasPointerCapture: typeof Element.prototype.hasPointerCapture;
  let originalReleasePointerCapture: typeof Element.prototype.releasePointerCapture;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    originalScrollIntoView = Element.prototype.scrollIntoView;
    originalHasPointerCapture = Element.prototype.hasPointerCapture;
    originalReleasePointerCapture = Element.prototype.releasePointerCapture;
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function press(element: Element): void {
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    (element as HTMLElement).click();
  }

  function renderKanban(role: TeamRole = "owner"): void {
    act(() => {
      root!.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <TeamKanban
            teamId={TEAM_ID}
            teamSlug="smoke-squad"
            tasks={tasks}
            members={members}
            virtualMembers={virtualMembers}
            today="2026-10-23"
            projectId={PROJECT_ID}
            projects={[{ id: PROJECT_ID, name: "官网改版" }]}
            role={role}
            actorId={OWNER_ID}
            projectSlug="project"
          />
        </NextIntlClientProvider>,
      );
    });
  }

  async function selectAssignee(label: string): Promise<void> {
    const trigger = document.body.querySelector<HTMLElement>(
      `[aria-label="${zh.tasks.filterByAssigneeAria}"]`,
    );
    if (!trigger) throw new Error("责任人筛选触发器未渲染");

    await act(async () => {
      press(trigger);
    });

    const option = Array.from(
      document.body.querySelectorAll('[role="option"]'),
    ).find((node) => node.textContent === label);
    if (!option) throw new Error(`责任人筛选选项未渲染：${label}`);

    await act(async () => {
      press(option);
    });
  }

  function visibleTitles(): string[] {
    const text = document.body.textContent ?? "";
    return [REAL_TITLE, VIRTUAL_TITLE, UNASSIGNED_TITLE].filter((title) =>
      text.includes(title),
    );
  }

  it("默认全部：三类责任人卡片都渲染虚拟成员机器人角标", () => {
    renderKanban();

    expect(visibleTitles()).toEqual([
      REAL_TITLE,
      VIRTUAL_TITLE,
      UNASSIGNED_TITLE,
    ]);
    expect(
      document.body.querySelector('[data-testid="assignee-avatar-bot-badge"]'),
    ).not.toBeNull();
  });

  it("选中虚拟成员：只保留 assigneeRef.type=virtual 且 id 匹配的卡片", async () => {
    renderKanban();
    await selectAssignee("写作助手");

    expect(visibleTitles()).toEqual([VIRTUAL_TITLE]);
  });

  it("选中真人成员：只保留 assigneeRef.type=user 且 userId 匹配的卡片", async () => {
    renderKanban();
    await selectAssignee("林夏");

    expect(visibleTitles()).toEqual([REAL_TITLE]);
  });

  it("选中未指派：只保留 assigneeRef 为 null 的卡片", async () => {
    renderKanban();
    await selectAssignee(zh.tasks.unassigned);

    expect(visibleTitles()).toEqual([UNASSIGNED_TITLE]);
  });
});
