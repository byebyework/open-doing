/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { ProjectDetailTabs } from "./ProjectDetailTabs";

const push = vi.fn();
const mockPathname = vi.fn();
const mockSearchParams = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}));

/** jsdom 探针：tab 行渲染、切 tab 的 URL 构造（保留其它参数 / overview 去 tab）。 */
describe("ProjectDetailTabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    push.mockReset();
    mockPathname.mockReturnValue("/space/personal/projects/p");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(active: "overview" | "tasks" | "activity") {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectDetailTabs active={active} />
        </NextIntlClientProvider>,
      );
    });
  }

  function trigger(value: string): HTMLButtonElement {
    const el = container.querySelector(
      `[role="tab"][data-value="${value}"], button[data-value="${value}"]`,
    );
    if (!el) {
      throw new Error(`trigger ${value} not found: ${container.innerHTML}`);
    }
    return el as HTMLButtonElement;
  }

  /** Radix Tabs 在 mousedown（button 0）激活，click 不触发 onValueChange。 */
  function activate(value: string) {
    act(() => {
      trigger(value).dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
  }

  it("三个 tab 都渲染，active 呈选中态", () => {
    mockSearchParams.mockReturnValue(new URLSearchParams());
    render("tasks");

    expect(trigger("overview")).toBeTruthy();
    expect(trigger("tasks")).toBeTruthy();
    expect(trigger("activity")).toBeTruthy();
    expect(trigger("tasks").getAttribute("data-state")).toBe("active");
    expect(trigger("overview").getAttribute("data-state")).not.toBe("active");
  });

  it("切到 tasks 保留 view/page 并写入 tab=tasks", () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams("view=list&page=2&size=20"),
    );
    render("overview");

    activate("tasks");

    expect(push).toHaveBeenCalledWith(
      "/space/personal/projects/p?view=list&page=2&size=20&tab=tasks",
    );
  });

  it("切到 overview 去掉 tab 但保留其它参数", () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("tab=tasks&view=list"));
    render("tasks");

    activate("overview");

    expect(push).toHaveBeenCalledWith(
      "/space/personal/projects/p?view=list",
    );
  });

  it("无参数时 push 裸 pathname", () => {
    mockSearchParams.mockReturnValue(new URLSearchParams());
    render("activity");

    activate("overview");

    expect(push).toHaveBeenCalledWith("/space/personal/projects/p");
  });

  /** layoutId 不落 DOM 属性（motion 消费掉），沿 React fiber 链向上找
   * memoizedProps 里的 layoutId（先例 TasksViewTabs.test）。 */
  function layoutIdOf(element: Element): unknown {
    const fiberKey = Object.keys(element).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    type FiberLike = { memoizedProps?: Record<string, unknown>; return?: FiberLike };
    let fiber: FiberLike | undefined = fiberKey
      ? ((element as unknown as Record<string, unknown>)[fiberKey] as FiberLike)
      : undefined;
    while (fiber) {
      const props = fiber.memoizedProps;
      if (props && typeof props === "object" && "layoutId" in props) {
        return props.layoutId;
      }
      fiber = fiber.return ?? undefined;
    }
    return undefined;
  }

  it("激活 tab 内渲染共享 layoutId 指示胶囊，非激活没有", () => {
    mockSearchParams.mockReturnValue(new URLSearchParams());
    render("tasks");

    const pillOnTasks = trigger("tasks").querySelector('span[aria-hidden="true"]');
    expect(pillOnTasks).not.toBeNull();
    expect(layoutIdOf(pillOnTasks as Element)).toBe("project-detail-active-pill");
    expect(
      trigger("overview").querySelector('span[aria-hidden="true"]'),
    ).toBeNull();
    expect(
      trigger("activity").querySelector('span[aria-hidden="true"]'),
    ).toBeNull();
  });
});
