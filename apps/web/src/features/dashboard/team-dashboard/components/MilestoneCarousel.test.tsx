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

import type { MilestoneTaskItem } from "@/features/dashboard/team-overview/service";

import { MilestoneCarousel } from "./MilestoneCarousel";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），沿用 date-picker.test.tsx
 * 的 jsdom + createRoot/act 最小探针写法。Motion 在 jsdom 下可直接渲染
 * （transform 动画不会阻塞断言，act 后到达终态）。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let mounted: { root: Root; container: HTMLElement } | null = null;

function unmountCarousel(): void {
  if (!mounted) return;

  act(() => {
    mounted!.root.unmount();
  });
  mounted.container.remove();
  mounted = null;
}

function makeTask(n: number): MilestoneTaskItem {
  return {
    id: `task-${n}`,
    title: `probe-task-${n}`,
    dueDate: "2026-11-01",
    kind: "overdue",
    assigneeName: "someone",
    projectName: "probe-project",
    href: `/space/t/kanban?task=${n}`,
  };
}

function renderCarousel(
  props: Partial<React.ComponentProps<typeof MilestoneCarousel>> & {
    tasks?: MilestoneTaskItem[];
  },
  locale: AppLocale = "zh",
) {
  unmountCarousel();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const { tasks = Array.from({ length: 10 }, (_, i) => makeTask(i + 1)), ...rest } =
    props;

  function Probe(): React.ReactNode {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
        <MilestoneCarousel tasks={tasks} today="2026-11-18" {...rest} />
      </NextIntlClientProvider>
    );
  }

  act(() => {
    root.render(<Probe />);
  });
  mounted = { root, container };

  const q = (selector: string) => document.body.querySelector(selector);

  return {
    container,
    q,
    /** 当前页可见的任务标题（行首标题 div，不含图标与元信息）。 */
    visibleTitles: () =>
      [
        ...document.body.querySelectorAll(
          "[data-slot=milestone-page][data-current='true'] a > div > div:first-child",
        ),
      ].map((el) => el.textContent?.trim() ?? ""),
    /** 上一页/下一页按钮。 */
    prevButton: () => q("button[data-slot='milestone-prev']") as HTMLButtonElement,
    nextButton: () => q("button[data-slot='milestone-next']") as HTMLButtonElement,
    /** 圆点指示器（含激活态）。 */
    dots: () => [...document.body.querySelectorAll("button[data-slot='milestone-dot']")],
    click: (button: HTMLButtonElement) =>
      act(() => {
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      }),
    unmount: unmountCarousel,
  };
}

describe("MilestoneCarousel（重要节点横向翻页轮播）", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });
  afterEach(() => {
    unmountCarousel();
    vi.unstubAllGlobals();
  });

  it("10 条按每页 5 条分 2 页，初始显示第 1 页前 5 条", () => {
    const carousel = renderCarousel({});

    expect(carousel.dots().length).toBe(2);
    expect(carousel.visibleTitles()).toEqual([
      "probe-task-1",
      "probe-task-2",
      "probe-task-3",
      "probe-task-4",
      "probe-task-5",
    ]);
    // 首页不可再往前翻。
    expect(carousel.prevButton().disabled).toBe(true);

    carousel.unmount();
  });

  it("点击下一页显示第 6-10 条，末页不可再往后翻；点回上一页恢复", () => {
    const carousel = renderCarousel({});

    carousel.click(carousel.nextButton());
    expect(carousel.visibleTitles()).toEqual([
      "probe-task-6",
      "probe-task-7",
      "probe-task-8",
      "probe-task-9",
      "probe-task-10",
    ]);
    expect(carousel.nextButton().disabled).toBe(true);

    carousel.click(carousel.prevButton());
    expect(carousel.visibleTitles()[0]).toBe("probe-task-1");
    expect(carousel.prevButton().disabled).toBe(true);

    carousel.unmount();
  });

  it("点击圆点直达对应页，激活圆点带 aria-current", () => {
    const carousel = renderCarousel({});

    const dots = carousel.dots();
    carousel.click(dots[1]! as HTMLButtonElement);
    expect(carousel.visibleTitles()[0]).toBe("probe-task-6");
    expect(dots[1]?.getAttribute("aria-current")).toBe("true");
    expect(dots[0]?.getAttribute("aria-current")).toBeNull();

    carousel.unmount();
  });

  it("≤5 条时只有一页，翻页控件整体隐藏", () => {
    const carousel = renderCarousel({
      tasks: Array.from({ length: 3 }, (_, i) => makeTask(i + 1)),
    });

    expect(carousel.dots().length).toBe(0);
    expect(carousel.prevButton()).toBeNull();
    expect(carousel.nextButton()).toBeNull();

    carousel.unmount();
  });

  it("aria 文案随语言切换（zh/en 消息键）", () => {
    const zhCarousel = renderCarousel({}, "zh");
    expect(zhCarousel.prevButton().getAttribute("aria-label")).toBe("上一页");
    zhCarousel.unmount();

    const enCarousel = renderCarousel({}, "en");
    expect(enCarousel.prevButton().getAttribute("aria-label")).toBe(
      "Previous page",
    );
    enCarousel.unmount();
  });
});
