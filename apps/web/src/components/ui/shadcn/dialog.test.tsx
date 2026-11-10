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

import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用
 * overlay-motion.test.tsx 的 jsdom + React 官方 act 最小探针写法：
 * 真实挂载到 document.body（Radix Portal 挂在 body 上），受控翻转
 * open、用 vi.useFakeTimers 驱动 useHeldOpen 的保持窗口。
 */
function createHarness(initialOpen: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenChange = vi.fn();
  let applyOpen: (open: boolean) => void = () => {};

  function Probe(): React.ReactNode {
    const [open, setOpen] = useState(initialOpen);
    applyOpen = setOpen;
    return (
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Delete task</DialogTitle>
            <p>body</p>
          </DialogContent>
        </Dialog>
      </NextIntlClientProvider>
    );
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    onOpenChange,
    setOpen(open: boolean): void {
      act(() => {
        applyOpen(open);
      });
    },
    advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    get content(): Element | null {
      return document.body.querySelector('[data-slot="dialog-content"]');
    },
    get overlay(): Element | null {
      return document.body.querySelector('[data-slot="dialog-overlay"]');
    },
    get srOnlyClose(): Element | null {
      return document.body.querySelector(
        '[data-slot="dialog-close"] .sr-only',
      );
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("Dialog 退出保持桥（motion 迁移）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("受控 open=true 立即渲染 overlay 与 content", () => {
    const harness = createHarness(true);
    expect(harness.overlay).not.toBeNull();
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("open 翻 false 后内容在保持窗口内仍在 document，窗口过后移除", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    // 受控翻 open 不触发 onOpenChange（它只在 Radix 发起关闭时即时回调，
    // 见非受控用例）；此处断言内容在保持窗口内仍挂在 document 上。
    expect(harness.onOpenChange).not.toHaveBeenCalled();
    expect(harness.content).not.toBeNull();

    harness.advance(OD_MS.modalOut + 50);
    expect(harness.content).toBeNull();
    expect(harness.overlay).toBeNull();
    harness.unmount();
  });

  it("保持窗口内重新 open，内容不消失", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    harness.advance(100);
    expect(harness.content).not.toBeNull();

    harness.setOpen(true);
    harness.advance(OD_MS.modalOut + 100);
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("关闭钮 sr-only 文案来自 common.close（不硬编码）", () => {
    const harness = createHarness(true);
    expect(harness.srOnlyClose?.textContent).toBe(zh.common.close);
    harness.unmount();
  });

  it("非受控用法：Trigger 打开、Close 关闭，同样走保持桥", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenChange = vi.fn();

    function UncontrolledProbe(): React.ReactNode {
      return (
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <Dialog onOpenChange={onOpenChange}>
            <DialogTrigger data-testid="opener">open</DialogTrigger>
            <DialogContent>
              <DialogTitle>Edit</DialogTitle>
              <DialogClose data-testid="closer">x</DialogClose>
            </DialogContent>
          </Dialog>
        </NextIntlClientProvider>
      );
    }

    act(() => {
      root.render(<UncontrolledProbe />);
    });
    expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="opener"]')?.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(document.body.querySelector('[data-slot="dialog-content"]')).not.toBeNull();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="closer"]')?.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.body.querySelector('[data-slot="dialog-content"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(document.body.querySelector('[data-slot="dialog-content"]')).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
