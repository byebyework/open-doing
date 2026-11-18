/**
 * @vitest-environment jsdom
 */
import { enUS, zhCN } from "date-fns/locale";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Calendar } from "./calendar";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 popover.test.tsx 的
 * jsdom + React 官方 act 最小探针写法：真实挂载到 document.body 后按角色
 * 定位 RDP v10 的月网格与 caption。react-day-picker 在 jsdom 下与 Radix
 * 一样需要 ResizeObserver 空壳（jsdom 未实现）。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let mounted: { root: Root; container: HTMLElement } | null = null;

function unmountCalendar(): void {
  if (!mounted) return;

  act(() => {
    mounted!.root.unmount();
  });
  mounted.container.remove();
  mounted = null;
}

function renderCalendar(props: React.ComponentProps<typeof Calendar>) {
  unmountCalendar();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Calendar {...props} />);
  });
  mounted = { root, container };

  return {
    /** RDP v10 的月网格（`<table role="grid">`）。 */
    grid: document.body.querySelector('[role="grid"]'),
    /** caption 文案（`CaptionLabel` 带 role="status"）。 */
    caption: document.body.querySelector('[role="status"]')?.textContent ?? "",
    day: (isoDate: string) =>
      document.body.querySelector(`[data-day="${isoDate}"]`),
    unmount: unmountCalendar,
  };
}

describe("Calendar（react-day-picker v10 薄封装）", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });
  afterEach(() => {
    unmountCalendar();
    vi.unstubAllGlobals();
  });

  it("zhCN：defaultMonth 2026-11 渲染月网格与中文月份 caption", () => {
    const calendar = renderCalendar({
      defaultMonth: new Date(2026, 10, 1),
      locale: zhCN,
    });

    expect(calendar.grid).not.toBeNull();
    expect(calendar.day("2026-11-18")).not.toBeNull();
    expect(calendar.caption).toContain("2026 年 11 月");

    calendar.unmount();
  });

  it("enUS：caption 为英文月份", () => {
    const calendar = renderCalendar({
      defaultMonth: new Date(2026, 10, 1),
      locale: enUS,
    });

    expect(calendar.grid).not.toBeNull();
    expect(calendar.caption).toContain("November 2026");

    calendar.unmount();
  });

  it("消费方传入的 classNames 与默认映射合并（默认样式不丢）", () => {
    const calendar = renderCalendar({
      defaultMonth: new Date(2026, 10, 1),
      locale: enUS,
      classNames: { month_grid: "custom-grid-class" },
    });

    const grid = calendar.grid as HTMLElement | null;
    expect(grid).not.toBeNull();
    // 默认 w-full / border-collapse 仍在，自定义类追加而非覆盖。
    expect(grid?.className).toContain("custom-grid-class");
    expect(grid?.className).toContain("border-collapse");

    calendar.unmount();
  });

  it("单月布局：months 不参与 md:flex-row（零宽 nav 在行向 flex 里顶出 16px gap），nav 以 contents 移出盒树", () => {
    const calendar = renderCalendar({
      defaultMonth: new Date(2026, 10, 1),
      locale: enUS,
    });

    // months 容器：单月固定纵排。
    const months = document.body.querySelector('[class*="relative flex"]');
    expect(months).not.toBeNull();
    expect(months?.className).toContain("flex-col");
    expect(months?.className).not.toContain("md:flex-row");
    expect(months?.className).not.toContain("gap-4");

    // nav：display:contents，不产生盒（prev/next 按钮锚定 months）。
    const nav = months?.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.className).toContain("contents");
    expect(nav?.className).not.toContain("w-full");

    calendar.unmount();
  });

  it("root 默认类不重复：classNames.root 与 className 各只出现一次 w-fit/p-3", () => {
    const calendar = renderCalendar({
      defaultMonth: new Date(2026, 10, 1),
      locale: enUS,
    });

    const root = calendar.grid!.closest("[class*='w-fit']");
    expect(root).not.toBeNull();
    expect(root?.className.match(/w-fit/g)?.length).toBe(1);
    expect(root?.className.match(/p-3/g)?.length).toBe(1);

    calendar.unmount();
  });
});
