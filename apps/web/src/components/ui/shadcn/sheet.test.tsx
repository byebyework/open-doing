/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";
import { OD_MS, sheetVariants } from "@/components/ui/overlay-motion";

import { Sheet, SheetContent, SheetTitle } from "./sheet";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 dialog.test.tsx 的
 * jsdom + React 官方 act 最小探针写法：真实挂载到 document.body（Radix
 * Portal 挂在 body 上），受控翻转 open、用 vi.useFakeTimers 驱动
 * useHeldOpen 的保持窗口（sheet 的保持时长是 OD_MS.sheetOut）。
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
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="right">
            <SheetTitle>Nav</SheetTitle>
            <p>body</p>
          </SheetContent>
        </Sheet>
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
      return document.body.querySelector('[data-slot="sheet-content"]');
    },
    get overlay(): Element | null {
      return document.body.querySelector('[data-slot="sheet-overlay"]');
    },
    get srOnlyClose(): Element | null {
      return document.body.querySelector(
        '[data-slot="sheet-content"] .sr-only',
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

describe("Sheet 退出保持桥（motion 迁移）", () => {
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

  it("right 侧挂载时 content 的 transform 即关闭态位移（屏幕外原点滑入）", () => {
    const harness = createHarness(true);
    // 入场初值取 closed 的 x:100%：挂载瞬间（入场动画尚未推进）transform
    // 就应是 translateX(100%)，随后由 Motion 滑入归位。
    expect((harness.content as HTMLElement).style.transform).toBe(
      "translateX(100%)",
    );
    harness.unmount();
  });

  it("open 翻 false 后内容在保持窗口内仍在 document，窗口过后移除", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    // 受控翻 open 不触发 onOpenChange（它只在 Radix 发起关闭时即时回调）；
    // 此处断言内容在保持窗口内仍挂在 document 上，退出动画得以播完。
    expect(harness.onOpenChange).not.toHaveBeenCalled();
    expect(harness.content).not.toBeNull();

    harness.advance(OD_MS.sheetOut + 50);
    expect(harness.content).toBeNull();
    expect(harness.overlay).toBeNull();
    harness.unmount();
  });

  it("保持窗口内重新 open，内容不消失（不闪退）", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    harness.advance(100);
    expect(harness.content).not.toBeNull();

    harness.setOpen(true);
    harness.advance(OD_MS.sheetOut + 100);
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("内容不再携带旧的 od-* CSS 动效类（动效全部由 Motion 驱动）", () => {
    const harness = createHarness(true);
    const classesOf = (el: Element | null): string[] =>
      ((el as HTMLElement | null)?.className ?? "").split(/\s+/);
    expect(classesOf(harness.content).some((c) => c.startsWith("od-"))).toBe(
      false,
    );
    expect(classesOf(harness.overlay).some((c) => c.startsWith("od-"))).toBe(
      false,
    );
    harness.unmount();
  });

  it("关闭钮 sr-only 文案来自 common.close（不硬编码）", () => {
    const harness = createHarness(true);
    expect(harness.srOnlyClose?.textContent).toBe(zh.common.close);
    harness.unmount();
  });
});

describe("sheetVariants 四向映射", () => {
  const cases = [
    { side: "right", x: "100%", y: 0 },
    { side: "left", x: "-100%", y: 0 },
    { side: "top", x: 0, y: "-100%" },
    { side: "bottom", x: 0, y: "100%" },
  ] as const;

  it.each(cases)("$side 侧 open 归位、closed 沿方向滑出", ({ side, x, y }) => {
    expect(sheetVariants(side).open).toMatchObject({ x: 0, y: 0 });
    expect(sheetVariants(side).closed).toMatchObject({ x, y });
  });
});
