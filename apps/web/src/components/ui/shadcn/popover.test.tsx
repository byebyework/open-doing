/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OD_MS } from "@/components/ui/overlay-motion";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
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

/**
 * immediate 模式（pop 家族）：Root open 即时跟随 desiredOpen，退出内容经
 * forceMount + 计时卸载保持挂载。回归点：关闭保持窗口内再次操作触发器必须
 * 立即重开（旧 held-Root 方案里 Radix 仍认为 open=true，toggle 会算成
 * close —— 首次重开点击是死的）。
 */
describe("pop 家族 immediate 模式（触发器重开 + forceMount 退场）", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // jsdom 未实现 scrollIntoView，Radix Select 聚焦选中项时会调用。
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  /** 真实浏览器里 click 之前必有 pointerdown；jsdom 的 .click() 只发 click。 */
  function pressTrigger(trigger: Element, mode: "pointerdown+click" | "pointerdown"): void {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    if (mode === "pointerdown+click") {
      (trigger as HTMLElement).click();
    }
  }

  function createUncontrolledHarness(
    render: (onOpenChange: (open: boolean) => void) => React.ReactNode,
    pressMode: "pointerdown+click" | "pointerdown",
    contentSelector: string,
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenChange = vi.fn();

    act(() => {
      root.render(render(onOpenChange));
    });
    const trigger = document.body.querySelector('[data-testid="opener"]');

    async function press(): Promise<void> {
      await act(async () => {
        if (trigger) pressTrigger(trigger, pressMode);
      });
    }
    function advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }
    function unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    return {
      onOpenChange,
      press,
      advance,
      unmount,
      get content(): Element | null {
        return document.body.querySelector(contentSelector);
      },
    };
  }

  it("Popover：保持窗口内再次点击触发器立即重开（dead click 修复）", async () => {
    const harness = createUncontrolledHarness(
      (onOpenChange) => (
        <Popover onOpenChange={onOpenChange}>
          <PopoverTrigger data-testid="opener">open</PopoverTrigger>
          <PopoverContent>popover body</PopoverContent>
        </Popover>
      ),
      "pointerdown+click",
      '[data-slot="popover-content"]',
    );

    await harness.press();
    expect(harness.onOpenChange).toHaveBeenLastCalledWith(true);
    expect(harness.content).not.toBeNull();

    // 让 DismissableLayer 的 document 监听完成注册（内部 setTimeout 0）。
    harness.advance(1);

    await harness.press();
    expect(harness.onOpenChange).toHaveBeenLastCalledWith(false);
    // 退场保持窗口内：content 仍挂载，但已是 closed 态且不可交互。
    expect(harness.content).not.toBeNull();
    expect((harness.content as HTMLElement).getAttribute("data-state")).toBe("closed");
    expect((harness.content as HTMLElement).style.pointerEvents).toBe("none");

    await harness.press();
    // 旧方案这里收到的是 close（Radix 以保持值算 toggle），首次重开点击是死的。
    expect(harness.onOpenChange).toHaveBeenLastCalledWith(true);
    expect((harness.content as HTMLElement).getAttribute("data-state")).toBe("open");
    expect((harness.content as HTMLElement).style.pointerEvents).not.toBe("none");

    harness.advance(OD_MS.popOut + 50);
    // 重开取消了退场计时，content 不会被移除。
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("DropdownMenu：保持窗口内再次按下触发器立即重开，退场层残留 dismiss 被吞掉", async () => {
    const harness = createUncontrolledHarness(
      (onOpenChange) => (
        <DropdownMenu onOpenChange={onOpenChange}>
          <DropdownMenuTrigger data-testid="opener">open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      "pointerdown",
      '[data-slot="dropdown-menu-content"]',
    );

    await harness.press();
    expect(harness.onOpenChange).toHaveBeenLastCalledWith(true);
    harness.advance(1);

    await harness.press();
    expect(harness.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(harness.content).not.toBeNull();

    await harness.press();
    // 触发器 toggle 重开之后，同一次 pointerdown 里退场层的 DismissableLayer
    // 仍会发 close —— 必须被吞掉，否则重开被再次关闭（死点击的另一半）。
    expect(harness.onOpenChange).toHaveBeenLastCalledWith(true);
    expect((harness.content as HTMLElement).getAttribute("data-state")).toBe("open");

    harness.advance(OD_MS.popOut + 100);
    expect(harness.content).not.toBeNull();
    harness.unmount();
  });

  it("Popover：受控 open 翻 false 后窗口内 content 为 closed 态保持挂载，窗口过后移除", () => {
    const harness = createHarness(true);

    harness.setOpen(false);
    expect(harness.content).not.toBeNull();
    expect((harness.content as HTMLElement).getAttribute("data-state")).toBe("closed");
    expect((harness.content as HTMLElement).style.pointerEvents).toBe("none");

    harness.advance(OD_MS.popOut + 50);
    expect(harness.content).toBeNull();
    harness.unmount();
  });

  it("Select：open 翻 false 后窗口内 content 仍在 document（closed 态），窗口过后移除", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let applyOpen: (open: boolean) => void = () => {};

    function Probe(): React.ReactNode {
      const [open, setOpen] = useState(true);
      applyOpen = setOpen;
      return (
        <Select open={open}>
          <SelectTrigger>
            <SelectValue placeholder="pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">A</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    act(() => {
      root.render(<Probe />);
    });
    expect(
      document.body.querySelector('[data-slot="select-content"]'),
    ).not.toBeNull();

    act(() => {
      applyOpen(false);
    });
    expect(
      document.body.querySelector('[data-slot="select-content"]'),
    ).not.toBeNull();
    expect(
      document
        .body.querySelector('[data-slot="select-content"]')
        ?.getAttribute("data-state"),
    ).toBe("closed");

    act(() => {
      vi.advanceTimersByTime(OD_MS.popOut + 50);
    });
    expect(
      document.body.querySelector('[data-slot="select-content"]'),
    ).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("DropdownMenu：open 翻 false 后窗口内 content 仍在 document（closed 态），窗口过后移除", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let applyOpen: (open: boolean) => void = () => {};

    function Probe(): React.ReactNode {
      const [open, setOpen] = useState(true);
      applyOpen = setOpen;
      return (
        <DropdownMenu open={open}>
          <DropdownMenuContent>
            <DropdownMenuItem>item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    act(() => {
      root.render(<Probe />);
    });
    expect(
      document.body.querySelector('[data-slot="dropdown-menu-content"]'),
    ).not.toBeNull();

    act(() => {
      applyOpen(false);
    });
    expect(
      document.body.querySelector('[data-slot="dropdown-menu-content"]'),
    ).not.toBeNull();
    expect(
      document
        .body.querySelector('[data-slot="dropdown-menu-content"]')
        ?.getAttribute("data-state"),
    ).toBe("closed");

    act(() => {
      vi.advanceTimersByTime(OD_MS.popOut + 50);
    });
    expect(
      document.body.querySelector('[data-slot="dropdown-menu-content"]'),
    ).toBeNull();

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
