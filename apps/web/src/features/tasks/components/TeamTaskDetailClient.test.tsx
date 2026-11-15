/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskDetailModel } from "@/components/ui/task-detail/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

const { refreshMock, updateActionMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  updateActionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock, replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children: ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("../actions", () => ({
  addTeamCommentAction: vi.fn(),
  addTeamSubtaskAction: vi.fn(),
  deleteTeamCommentAction: vi.fn(),
  deleteTeamTaskAction: vi.fn(),
  removeTeamSubtaskAction: vi.fn(),
  toggleTeamSubtaskAction: vi.fn(),
  updateTeamTaskAction: updateActionMock,
}));

const { TeamTaskDetailClient } = await import("./TeamTaskDetailClient");

const TEAM_ID = "55555555-5555-5555-5555-555555555555";
const VIRTUAL_ID = "66666666-6666-6666-6666-666666666666";
const REAL_ID = "33333333-3333-3333-3333-333333333333";
const OWNER_ID = "44444444-4444-4444-4444-444444444444";

const virtualAssignedTask: TaskDetailModel = {
  id: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  spaceType: "team",
  title: "整理竞品分析",
  status: "todo",
  priority: "medium",
  assigneeId: null,
  assigneeName: "写作助手",
  assigneeVirtualId: VIRTUAL_ID,
  assigneeVirtualName: "写作助手",
  assigneeAccentColor: "#a66b00",
  assigneeEmail: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  projectName: "官网改版",
  progress: 0,
  subtasks: [],
  comments: [],
  creatorName: "林夏",
};

/** jsdom 未实现的 DOM 探针 API（Radix Select / Popper 需要）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * 虚拟成员责任人的详情页改派：只读虚拟行保留，下方的真人 Select 选中
 * 成员后走既有的 updateTeamTaskAction 路径（只带 assigneeId）。
 */
describe("TeamTaskDetailClient 虚拟责任人改派", () => {
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

  function find<T extends Element>(selector: string): T | null {
    return document.body.querySelector<T>(selector);
  }

  function renderDetail(): void {
    act(() => {
      root!.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <TeamTaskDetailClient
            task={virtualAssignedTask}
            teamId={TEAM_ID}
            backHref="/space/smoke-squad/projects/project"
            currentUserId={OWNER_ID}
            permissions={{ canEdit: true, canDelete: true, canAssign: true }}
            assigneeOptions={[
              { id: REAL_ID, name: "林夏", email: null },
              { id: OWNER_ID, name: "owner_smoke", email: null },
            ]}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  /** 真实浏览器 click 前必有 pointerdown；jsdom 的 .click() 只发 click。 */
  function press(element: Element): void {
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    (element as HTMLElement).click();
  }

  it("虚拟责任人显示只读行 + 真人改派选择器", () => {
    renderDetail();

    expect(document.body.textContent).toContain("写作助手");
    expect(find('[data-testid="assignee-avatar-bot-badge"]')).not.toBeNull();
    expect(find('[data-testid="task-assignee-select"]')).not.toBeNull();
  });

  it("选择真人成员后调用 update action：带 assigneeId、不带 assigneeVirtualId", async () => {
    updateActionMock.mockResolvedValue({ ok: true, data: {} });
    renderDetail();

    const trigger = find<HTMLElement>('[data-testid="task-assignee-select"]');
    if (!trigger) throw new Error("责任人选择器未渲染");

    await act(async () => {
      press(trigger);
    });

    const option = Array.from(
      document.body.querySelectorAll('[role="option"]'),
    ).find((node) => node.textContent === "林夏");
    if (!option) throw new Error("真人成员选项未渲染");

    await act(async () => {
      press(option);
    });

    expect(updateActionMock).toHaveBeenCalledTimes(1);
    const [taskId, input] = updateActionMock.mock.calls[0]!;
    expect(taskId).toBe(virtualAssignedTask.id);
    expect(input).toMatchObject({ teamId: TEAM_ID, assigneeId: REAL_ID });
    expect(input).not.toHaveProperty("assigneeVirtualId");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
