/**
 * @vitest-environment jsdom
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import en from "@/i18n/messages/en.json";
import zh from "@/i18n/messages/zh.json";
import { OD_MS } from "@/components/ui/overlay-motion";

import { DatePicker, formatISODate, parseISODate } from "./date-picker";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 popover.test.tsx 的
 * jsdom + React 官方 act 最小探针写法：真实挂载到 document.body（Radix
 * Portal 挂在 body 上），用 vi.useFakeTimers 驱动退出保持窗口。Radix
 * Popper 与 react-day-picker 在布局阶段都会 new ResizeObserver（jsdom
 * 未实现），这里给一个空壳。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let mounted: { root: Root; container: HTMLElement } | null = null;

function unmountPicker(): void {
  if (!mounted) return;

  act(() => {
    mounted!.root.unmount();
  });
  mounted.container.remove();
  mounted = null;
}

function renderPicker(
  props: React.ComponentProps<typeof DatePicker>,
  locale: AppLocale = "zh",
) {
  unmountPicker();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <DatePicker {...props} />
      </NextIntlClientProvider>,
    );
  });
  mounted = { root, container };

  return {
    get input(): HTMLInputElement | null {
      return document.body.querySelector<HTMLInputElement>('[data-testid="t1"]');
    },
    get content(): HTMLElement | null {
      return document.body.querySelector<HTMLElement>(
        '[data-slot="popover-content"]',
      );
    },
    /** RDP v10 的月网格（`<table role="grid">`）。 */
    get grid(): Element | null {
      return document.body.querySelector('[role="grid"]');
    },
    /** caption 文案（`CaptionLabel` 带 role="status"）。 */
    get caption(): string {
      return document.body.querySelector('[role="status"]')?.textContent ?? "";
    },
    dayButton(isoDate: string): HTMLButtonElement | null {
      return document.body.querySelector<HTMLButtonElement>(
        `[data-day="${isoDate}"] button`,
      );
    },
    async click(element: Element | null): Promise<void> {
      await act(async () => {
        (element as HTMLElement).click();
      });
    },
    advance(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    unmount: unmountPicker,
  };
}

describe("parseISODate / formatISODate（零时区运算）", () => {
  it("YYYY-MM-DD ↔ 本地 Date 往返恒等", () => {
    for (const value of ["2026-11-18", "2024-02-29", "2000-01-01", "2026-12-31"]) {
      const day = parseISODate(value);
      expect(day).toBeInstanceOf(Date);
      // 只走本地 Y/M/D 拆装，不经 UTC 解析（不会因时区偏移串日）。
      expect(day?.getFullYear()).toBe(Number(value.slice(0, 4)));
      expect(day?.getMonth()).toBe(Number(value.slice(5, 7)) - 1);
      expect(day?.getDate()).toBe(Number(value.slice(8, 10)));
      expect(formatISODate(day!)).toBe(value);
    }
  });

  it("空串与非法输入返回 undefined", () => {
    expect(parseISODate("")).toBeUndefined();
    expect(parseISODate("abc")).toBeUndefined();
    expect(parseISODate("2026-1-5")).toBeUndefined();
    expect(parseISODate("2026-13-01")).toBeUndefined();
    expect(parseISODate("2026-02-30")).toBeUndefined();
  });

  it("formatISODate 月日两位补零", () => {
    expect(formatISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatISODate(new Date(2026, 10, 18))).toBe("2026-11-18");
  });
});

describe("DatePicker（原生 date input + Popover 日历）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });
  afterEach(() => {
    unmountPicker();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("挂载时渲染原生 date input，且日历默认不弹出", () => {
    const picker = renderPicker({
      value: "2026-11-18",
      onChange: vi.fn(),
      testid: "t1",
    });

    expect(picker.input).not.toBeNull();
    expect(picker.input?.type).toBe("date");
    expect(picker.input?.value).toBe("2026-11-18");
    // 聚焦不弹日历，未点击前 body 中无日历网格。
    expect(picker.grid).toBeNull();

    picker.unmount();
  });

  it("点击 input 弹出日历；选择日期写回并关闭（无 Trigger 按钮）", async () => {
    const onChange = vi.fn();
    const picker = renderPicker({
      value: "2026-11-18",
      onChange,
      testid: "t1",
    });

    await picker.click(picker.input);
    expect(picker.grid).not.toBeNull();
    expect(picker.content?.getAttribute("data-state")).toBe("open");
    // 月份导航的 aria label 走 date.pickerPreviousMonth / pickerNextMonth 消息键。
    expect(
      document.body.querySelector('button[aria-label="上个月"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('button[aria-label="下个月"]'),
    ).not.toBeNull();

    await picker.click(picker.dayButton("2026-11-18"));
    expect(onChange).toHaveBeenCalledWith("2026-11-18");

    // 关闭后进入退出保持窗口：内容仍在但已 closed，窗口过后卸载。
    expect(picker.content?.getAttribute("data-state")).toBe("closed");
    picker.advance(OD_MS.popOut + 50);
    expect(picker.content).toBeNull();

    picker.unmount();
  });

  it("locale=en 时日历 caption 为英文", async () => {
    const picker = renderPicker(
      { value: "2026-11-18", onChange: vi.fn(), testid: "t1" },
      "en",
    );

    await picker.click(picker.input);
    expect(picker.grid).not.toBeNull();
    expect(picker.caption).toContain("November 2026");

    picker.unmount();
  });
});
