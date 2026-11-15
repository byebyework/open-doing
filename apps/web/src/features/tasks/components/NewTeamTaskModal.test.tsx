/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

const { createActionMock, toastSuccessMock, successMock } = vi.hoisted(() => ({
  createActionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  successMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

vi.mock("../actions", () => ({
  createTeamTaskAction: createActionMock,
}));

const { NewTeamTaskModal } = await import("./NewTeamTaskModal");

const TEAM_ID = "55555555-5555-5555-5555-555555555555";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const VIRTUAL_ID = "66666666-6666-6666-6666-666666666666";

const projects = [{ id: PROJECT_ID, name: "官网改版" }];
const members = [{ id: MEMBER_ID, name: "林夏" }];
const virtualMembers = [
    { id: VIRTUAL_ID, name: "写作助手", accentColor: "#a66b00" },
];

/** jsdom 未实现的 DOM 探针 API（Radix Select / Popper 需要）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 popover.test.tsx /
 * VirtualMemberManager.test.tsx 的 jsdom + React 官方 act 最小探针写法：
 * 真实挂载组件（Radix Portal 挂在 document.body 上），用
 * pointerdown + click 驱动 Radix Select 的点选。
 */
describe("NewTeamTaskModal 虚拟成员责任人", () => {
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

  function renderModal(withVirtualMembers: boolean): void {
    act(() => {
      root!.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <NewTeamTaskModal
            open
            teamId={TEAM_ID}
            projects={projects}
            defaultProjectId={PROJECT_ID}
            members={members}
            defaultAssigneeId={MEMBER_ID}
            virtualMembers={withVirtualMembers ? virtualMembers : undefined}
            onSuccess={successMock}
            onCancel={() => {}}
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

  async function openAssigneeSelect(): Promise<void> {
    const trigger = find<HTMLElement>('#team-task-assignee');
    if (!trigger) throw new Error("责任人触发器未渲染");

    await act(async () => {
      press(trigger);
    });
  }

  function findOption(label: string): Element {
    const option = Array.from(
      document.body.querySelectorAll('[role="option"]'),
    ).find((node) => node.textContent === label);
    if (!option) throw new Error(`责任人选项未渲染：${label}`);
    return option;
  }

  async function selectAssigneeOption(label: string): Promise<void> {
    await openAssigneeSelect();
    await act(async () => {
      press(findOption(label));
    });
  }

  async function typeTitle(value: string): Promise<void> {
    const input = find<HTMLInputElement>('[data-testid="task-title-input"]');
    if (!input) throw new Error("标题输入框未渲染");

    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      setValue?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit(): Promise<void> {
    const button = find<HTMLElement>(
      '[data-testid="task-create-submit-button"]',
    );
    if (!button) throw new Error("提交按钮未渲染");

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
  }

  it("虚拟团队：责任人下拉带虚拟成员分组标签，选中后提交 assigneeVirtualId 且不带 assigneeId", async () => {
    createActionMock.mockResolvedValue({ ok: true, data: {} });
    renderModal(true);

    await openAssigneeSelect();

    expect(find('[data-slot="select-label"]')?.textContent).toBe(
      zh.tasks.assigneeVirtualGroup,
    );

    await selectAssigneeOption("写作助手");
    await typeTitle("整理周报");
    await submit();

    expect(createActionMock).toHaveBeenCalledTimes(1);
    const payload = createActionMock.mock.calls[0]![0];
    expect(payload).toMatchObject({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      title: "整理周报",
      assigneeVirtualId: VIRTUAL_ID,
    });
    expect(payload).not.toHaveProperty("assigneeId");
  });

  it("真实团队：无虚拟分组，默认责任人仍为自己，提交 assigneeId 且不带 assigneeVirtualId", async () => {
    createActionMock.mockResolvedValue({ ok: true, data: {} });
    renderModal(false);

    await openAssigneeSelect();
    expect(find('[data-slot="select-label"]')).toBeNull();

    await typeTitle("整理周报");
    await submit();

    expect(createActionMock).toHaveBeenCalledTimes(1);
    const payload = createActionMock.mock.calls[0]![0];
    expect(payload).toMatchObject({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      title: "整理周报",
      assigneeId: MEMBER_ID,
    });
    expect(payload).not.toHaveProperty("assigneeVirtualId");
  });
});
