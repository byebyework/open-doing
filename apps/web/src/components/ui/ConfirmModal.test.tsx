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
});
