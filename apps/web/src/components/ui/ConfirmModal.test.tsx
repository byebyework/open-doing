/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";
import { OD_MS } from "@/components/ui/overlay-motion";

import { ConfirmModal } from "./ConfirmModal";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 dialog.test.tsx 的
 * jsdom + React 官方 act 最小探针写法：真实挂载到 document.body（Radix
 * Portal 挂在 body 上），用 vi.useFakeTimers 驱动 useHeldOpen 的保持窗口。
 *
 * 覆盖退出保持窗口内「迟到点击」的幂等闸门：open 已翻 false 后内容仍挂载
 * OD_MS.modalOut，若不闸门，消费方非幂等的 onConfirm 会被二次触发。
 */
function createHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  function Probe(): React.ReactNode {
    const [open, setOpen] = useState(true);
    return (
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <ConfirmModal
          open={open}
          title={zh.common.confirm}
          content={zh.common.cancel}
          confirmText={zh.common.confirm}
          okButtonProps={{ "data-testid": "confirm-button" }}
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      </NextIntlClientProvider>
    );
  }

  act(() => {
    root.render(<Probe />);
  });

  function click(element: Element | null): void {
    act(() => {
      (element as HTMLButtonElement | null)?.click();
    });
  }

  return {
    onConfirm,
    onCancel,
    advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    get content(): Element | null {
      return document.body.querySelector('[data-slot="alert-dialog-content"]');
    },
    get confirmButton(): Element | null {
      return document.body.querySelector('[data-testid="confirm-button"]');
    },
    get cancelButton(): Element | null {
      const buttons = document.body.querySelectorAll(
        '[data-slot="alert-dialog-content"] button',
      );
      return (
        Array.from(buttons).find((button) =>
          button.textContent?.includes(zh.common.cancel),
        ) ?? null
      );
    },
    clickConfirm(): void {
      click(this.confirmButton);
    },
    clickCancel(): void {
      click(this.cancelButton);
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/**
 * 异步提交探针：loading 由消费方驱动，测试手动 resolve 一次提交的结果
 * （第一次失败保持弹窗，第二次成功关闭），用于钉住 loading 语义与重试路径。
 */
function createRetryHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  let finishSubmit: (() => void) | null = null;
  let submitCount = 0;

  function Probe(): React.ReactNode {
    const [open, setOpen] = useState(true);
    const [loading, setLoading] = useState(false);

    function handleConfirm(): void {
      onConfirm();
      const attempt = submitCount + 1;
      submitCount = attempt;
      setLoading(true);
      finishSubmit = () => {
        setLoading(false);
        // 第一次提交失败：保持弹窗，允许重试；第二次成功：关闭。
        if (attempt > 1) setOpen(false);
      };
    }

    return (
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <ConfirmModal
          open={open}
          title={zh.common.confirm}
          content={zh.common.cancel}
          confirmText={zh.common.confirm}
          loading={loading}
          okButtonProps={{ "data-testid": "confirm-button" }}
          onConfirm={handleConfirm}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      </NextIntlClientProvider>
    );
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    onConfirm,
    onCancel,
    clickConfirm(): void {
      act(() => {
        document.body
          .querySelector<HTMLButtonElement>('[data-testid="confirm-button"]')
          ?.click();
      });
    },
    finishSubmit(): void {
      act(() => {
        finishSubmit?.();
      });
    },
    advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    get content(): Element | null {
      return document.body.querySelector('[data-slot="alert-dialog-content"]');
    },
    get confirmButton(): HTMLButtonElement | null {
      return document.body.querySelector('[data-testid="confirm-button"]');
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("ConfirmModal 退出保持窗口内的幂等闸门", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("open 翻 false 后、内容卸载前，重复点击确认不会再触发 onConfirm", () => {
    const harness = createHarness();
    expect(harness.content).not.toBeNull();

    harness.clickConfirm();
    expect(harness.onConfirm).toHaveBeenCalledTimes(1);
    // 保持窗口内内容仍在（退场动画尚未播完）。
    expect(harness.content).not.toBeNull();

    harness.clickConfirm();
    expect(harness.onConfirm).toHaveBeenCalledTimes(1);

    harness.advance(OD_MS.modalOut + 50);
    expect(harness.content).toBeNull();
    harness.unmount();
  });

  it("open 翻 false 后、内容卸载前，重复点击取消不会再触发 onCancel", () => {
    const harness = createHarness();
    expect(harness.cancelButton).not.toBeNull();

    harness.clickCancel();
    expect(harness.onCancel).toHaveBeenCalledTimes(1);
    expect(harness.content).not.toBeNull();

    harness.clickCancel();
    expect(harness.onCancel).toHaveBeenCalledTimes(1);

    harness.advance(OD_MS.modalOut + 50);
    expect(harness.content).toBeNull();
    harness.unmount();
  });

  it("loading 期间不再提交；失败保持弹窗，重试成功共两次提交", () => {
    const harness = createRetryHarness();
    expect(harness.content).not.toBeNull();

    harness.clickConfirm();
    expect(harness.onConfirm).toHaveBeenCalledTimes(1);
    // 提交中：按钮禁用（loading 闸门的第一道防线），再点不会重复提交。
    expect(harness.confirmButton?.disabled).toBe(true);
    harness.clickConfirm();
    expect(harness.onConfirm).toHaveBeenCalledTimes(1);

    // 第一次失败：loading 结束、弹窗保持。
    harness.finishSubmit();
    expect(harness.content).not.toBeNull();
    expect(harness.confirmButton?.disabled).toBe(false);

    // 重试成功：第二次提交后关闭，进入退出保持窗口。
    harness.clickConfirm();
    expect(harness.onConfirm).toHaveBeenCalledTimes(2);
    harness.finishSubmit();
    expect(harness.content).not.toBeNull();

    harness.advance(OD_MS.modalOut + 50);
    expect(harness.content).toBeNull();
    harness.unmount();
  });
});
