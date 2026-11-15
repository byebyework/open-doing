/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VirtualMember } from "@open-doing/types";

import { OD_MS } from "@/components/ui/overlay-motion";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

const {
  refreshMock,
  createActionMock,
  updateActionMock,
  removeActionMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  createActionMock: vi.fn(),
  updateActionMock: vi.fn(),
  removeActionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: refreshMock,
    replace: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, warning: vi.fn() },
}));

vi.mock("../actions", () => ({
  createVirtualMemberAction: createActionMock,
  updateVirtualMemberAction: updateActionMock,
  removeVirtualMemberAction: removeActionMock,
}));

const { VirtualMemberManager } = await import("./VirtualMemberManager");

const members: VirtualMember[] = [
  {
    id: "vm-1",
    teamId: "team-1",
    name: "写作助手",
    role: "admin",
    description: "负责周报",
    accentColor: "#a66b00",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "vm-2",
    teamId: "team-1",
    name: "绘图助手",
    role: "member",
    description: undefined,
    accentColor: "#0b6fb8",
    createdAt: "2026-10-02T00:00:00.000Z",
  },
];

const TEAM_SLUG = "agent-squad";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 create-code-dialog /
 * ConfirmModal 的 jsdom + React 官方 act 最小探针写法：真实挂载组件（Radix
 * Portal 挂在 document.body 上），fake timers 驱动 overlay 退出保持窗口。
 */
describe("VirtualMemberManager", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function find<T extends Element>(selector: string): T | null {
    return document.body.querySelector<T>(selector);
  }

  function renderManager(list: VirtualMember[] = members): void {
    act(() => {
      root!.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <VirtualMemberManager teamSlug={TEAM_SLUG} members={list} />
        </NextIntlClientProvider>,
      );
    });
  }

  async function click(testId: string): Promise<void> {
    const button = find<HTMLElement>(`[data-testid="${testId}"]`);
    if (!button) throw new Error(`${testId} missing`);

    await act(async () => {
      button.click();
    });
  }

  async function typeInto(testId: string, value: string): Promise<void> {
    const input = find<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (!input) throw new Error(`${testId} missing`);

    // React 受控 input 需绕过 value tracker：原型 setter 赋值后派发 input。
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      setValue?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("列表渲染虚拟成员：名称、角色、说明与机器人标记", () => {
    renderManager();

    expect(find('[data-testid="virtual-member-vm-1"]')?.textContent).toContain("写作助手");
    expect(find('[data-testid="virtual-member-vm-1"]')?.textContent).toContain(
      zh.teams.virtualMembers.roleAdmin,
    );
    expect(find('[data-testid="virtual-member-vm-1"]')?.textContent).toContain("负责周报");
    expect(find('[data-testid="virtual-member-bot-badge-vm-1"]')).not.toBeNull();
  });

  it("添加：提交对话框表单调用 create action，成功后刷新并关闭", async () => {
    createActionMock.mockResolvedValue({ ok: true, data: members[0] });
    renderManager();

    await click("add-virtual-member");
    expect(find('[data-testid="virtual-member-name-input"]')).not.toBeNull();

    await typeInto("virtual-member-name-input", "  新助手  ");
    await click("virtual-member-submit");
    await flushAsync();

    expect(createActionMock).toHaveBeenCalledWith({
      teamSlug: TEAM_SLUG,
      name: "新助手",
      role: "member",
      description: "",
      accentColor: "#a66b00",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(zh.teams.virtualMembers.created);

    // 成功分支才 close：退出保持窗口结束后内容卸载。
    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="dialog-content"]')).toBeNull();
  });

  it("字段错误：服务端 name 错误落在名称字段，弹窗保持打开且不刷新", async () => {
    createActionMock.mockResolvedValue({
      ok: false,
      errors: { name: zh.teams.virtualMemberNameDuplicate },
    });
    renderManager();

    await click("add-virtual-member");
    await typeInto("virtual-member-name-input", "写作助手");
    await click("virtual-member-submit");
    await flushAsync();

    expect(find('[data-testid="virtual-member-name-error"]')?.textContent).toBe(
      zh.teams.virtualMemberNameDuplicate,
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(find('[data-slot="dialog-content"]')).not.toBeNull();
  });

  it("表单级错误：落到弹窗顶部 Alert，弹窗保持打开", async () => {
    createActionMock.mockResolvedValue({
      ok: false,
      errors: { form: zh.teams.virtualTeamOnly },
    });
    renderManager();

    await click("add-virtual-member");
    await typeInto("virtual-member-name-input", "写作助手");
    await click("virtual-member-submit");
    await flushAsync();

    expect(find('[data-testid="virtual-member-form-error"]')?.textContent).toBe(
      zh.teams.virtualTeamOnly,
    );
    expect(find('[data-slot="dialog-content"]')).not.toBeNull();
  });

  it("编辑：对话框预填当前值，提交调用 update action", async () => {
    updateActionMock.mockResolvedValue({ ok: true, data: members[0] });
    renderManager();

    await click("edit-virtual-member-vm-1");
    expect(
      find<HTMLInputElement>('[data-testid="virtual-member-name-input"]')?.value,
    ).toBe("写作助手");

    await typeInto("virtual-member-name-input", "写作机器人");
    await click("virtual-member-submit");
    await flushAsync();

    expect(updateActionMock).toHaveBeenCalledWith({
      teamSlug: TEAM_SLUG,
      virtualMemberId: "vm-1",
      name: "写作机器人",
      role: "admin",
      description: "负责周报",
      accentColor: "#a66b00",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(zh.teams.virtualMembers.updated);

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
  });

  it("移除：ConfirmModal 确认调用 remove action，仅在成功分支关闭", async () => {
    removeActionMock.mockResolvedValue({ ok: true, data: null });
    renderManager();

    await click("remove-virtual-member-vm-1");
    expect(find('[data-testid="confirm-remove-virtual-member"]')).not.toBeNull();

    await click("confirm-remove-virtual-member");
    await flushAsync();

    expect(removeActionMock).toHaveBeenCalledWith({
      teamSlug: TEAM_SLUG,
      virtualMemberId: "vm-1",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(zh.teams.virtualMembers.removed);

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-testid="confirm-remove-virtual-member"]')).toBeNull();
  });

  it("移除失败：弹窗保持、不刷新、显示错误 toast", async () => {
    removeActionMock.mockResolvedValue({
      ok: false,
      errors: { form: zh.teams.removeVirtualMemberFailed },
    });
    renderManager();

    await click("remove-virtual-member-vm-1");
    await click("confirm-remove-virtual-member");
    await flushAsync();

    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(zh.teams.removeVirtualMemberFailed);
    expect(find('[data-testid="confirm-remove-virtual-member"]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
  });
});
