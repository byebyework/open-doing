/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OD_MS } from "@/components/ui/overlay-motion";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 dialog.test.tsx 的
 * jsdom + React 官方 act 最小探针写法：真实挂载到 document.body（Radix
 * Portal 挂在 body 上），受控翻转 open、用 vi.useFakeTimers 驱动
 * useHeldOpen 的保持窗口。Popover/Select/DropdownMenu 底层的 Radix Popper
 * 在 layout 阶段无条件 new ResizeObserver（jsdom 未实现），这里给一个空壳。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

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
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger>trigger</PopoverTrigger>
        <PopoverContent>popover body</PopoverContent>
      </Popover>
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
      return document.body.querySelector('[data-slot="popover-content"]');
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("Popover 退出保持桥（motion 迁移）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("受控 open=true 立即渲染 content", () => {
    const harness = createHarness(true);
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("open 翻 false 后内容在保持窗口内仍在 document，窗口过后移除", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    // 受控翻 open 不触发 onOpenChange（它只在 Radix 发起关闭时即时回调）。
    expect(harness.onOpenChange).not.toHaveBeenCalled();
    expect(harness.content).not.toBeNull();

    harness.advance(OD_MS.popOut + 50);
    expect(harness.content).toBeNull();
    harness.unmount();
  });

  it("保持窗口内重新 open，内容不消失", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    harness.advance(100);
    expect(harness.content).not.toBeNull();

    harness.setOpen(true);
    harness.advance(OD_MS.popOut + 100);
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("缩放原点跟随 Radix 锚点角（--radix-popover-content-transform-origin）", () => {
    const harness = createHarness(true);
    const style = (harness.content as HTMLElement | null)?.style;
    expect(style?.transformOrigin).toBe(
      "var(--radix-popover-content-transform-origin)",
    );
    harness.unmount();
  });

  it("非受控用法：Trigger 打开，onOpenChange 即时回调", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <Popover onOpenChange={onOpenChange}>
          <PopoverTrigger data-testid="opener">open</PopoverTrigger>
          <PopoverContent>popover body</PopoverContent>
        </Popover>,
      );
    });

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="opener"]')
        ?.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(document.body.querySelector('[data-slot="popover-content"]')).not.toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

describe("Select / DropdownMenu 轻量冒烟（motion 迁移）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("Select open 时渲染 content，并挂 select 的缩放原点变量", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <Select open>
          <SelectTrigger>
            <SelectValue placeholder="pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">A</SelectItem>
          </SelectContent>
        </Select>,
      );
    });

    const content = document.body.querySelector<HTMLElement>(
      '[data-slot="select-content"]',
    );
    expect(content).not.toBeNull();
    expect(content?.style.transformOrigin).toBe(
      "var(--radix-select-content-transform-origin)",
    );

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("DropdownMenu open 时渲染 content，并挂 dropdown 的缩放原点变量", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <DropdownMenu open>
          <DropdownMenuContent>
            <DropdownMenuItem>item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });

    const content = document.body.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-content"]',
    );
    expect(content).not.toBeNull();
    expect(content?.style.transformOrigin).toBe(
      "var(--radix-dropdown-menu-content-transform-origin)",
    );

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
