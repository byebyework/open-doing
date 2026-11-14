/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OD_MS } from "@/components/ui/overlay-motion";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

const { refreshMock, createActionMock, toastSuccessMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  createActionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: refreshMock,
    replace: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

vi.mock("./actions", () => ({
  createRegistrationCodeAction: createActionMock,
}));

const { CreateCodeDialog } = await import("./components/create-code-dialog");

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 overlay-motion /
 * dialog 测试的 jsdom + React 官方 act 最小探针写法：真实挂载组件（Radix
 * Portal 挂在 document.body 上），用 vi.useFakeTimers 驱动退出保持窗口。
 */
describe("CreateCodeDialog", () => {
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

  async function openDialog(): Promise<void> {
    const trigger = find<HTMLButtonElement>('[data-testid="create-code-trigger"]');
    if (!trigger) throw new Error("create-code trigger missing");

    await act(async () => {
      trigger.click();
    });
  }

  function renderDialog(): void {
    act(() => {
      root!.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <CreateCodeDialog />
        </NextIntlClientProvider>,
      );
    });
  }

  async function changeMaxUses(value: string): Promise<void> {
    const input = find<HTMLInputElement>('[data-testid="code-max-uses-input"]');
    if (!input) throw new Error("max uses input missing");

    // React 的受控 input 需要绕过 value tracker：用原型 setter 赋值后派发 input。
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
    const button = find<HTMLButtonElement>('[data-testid="create-code-submit"]');
    if (!button) throw new Error("submit button missing");

    await act(async () => {
      button.click();
    });
    // onSubmit 是 async：让 action 的 Promise 与 setState 在 act 内冲刷完。
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("submits and calls router.refresh on success", async () => {
    createActionMock.mockResolvedValue({ ok: true, data: { code: "OD-ABC123" } });
    renderDialog();
    await openDialog();
    await submit();

    expect(createActionMock).toHaveBeenCalledWith(10);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      zh.admin.codesCreateSuccess.replace("{code}", "OD-ABC123"),
    );

    // 成功分支置 open=false；退出保持窗口结束后内容才真正卸载。
    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="dialog-content"]')).toBeNull();
  });

  it("keeps the dialog open and shows the field error on failure", async () => {
    createActionMock.mockResolvedValue({
      ok: false,
      errors: { maxUses: zh.admin.adminMaxUsesRange },
    });
    renderDialog();
    await openDialog();
    await submit();

    expect(createActionMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(find('[data-slot="dialog-content"]')).not.toBeNull();
    expect(find('[data-testid="code-max-uses-error"]')?.textContent).toBe(
      zh.admin.adminMaxUsesRange,
    );
  });

  it("gates a second submit while the first request is loading", async () => {
    let resolveAction: (value: unknown) => void = () => {};
    createActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderDialog();
    await openDialog();
    await submit();
    expect(createActionMock).toHaveBeenCalledTimes(1);

    // 按钮已 disabled；直接派发 form submit 事件模拟「回车再次提交」，
    // 验证 handler 的 !open || loading 幂等闸门（而非仅靠 disabled）。
    const form = find<HTMLFormElement>("form");
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(createActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAction({ ok: true, data: { code: "OD-ABC123" } });
    });
  });

  it("rejects an out-of-range max uses before calling the action", async () => {
    renderDialog();
    await openDialog();
    await changeMaxUses("0");
    await submit();

    expect(createActionMock).not.toHaveBeenCalled();
    expect(find('[data-testid="code-max-uses-error"]')?.textContent).toBe(
      zh.admin.adminMaxUsesRange,
    );
  });
});
