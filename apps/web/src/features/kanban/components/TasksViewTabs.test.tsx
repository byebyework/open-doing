/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";

import { TasksViewTabs, type TasksView } from "./TasksViewTabs";

/**
 * 双视图壳探针：仓库 vitest 是 node 环境（无 @testing-library），交互
 * 组件测试沿用 LanguageSwitch.test.tsx 的 jsdom + React 官方 act 最小
 * 探针写法：真实挂载到 DOM、原生 click / KeyboardEvent、读 DOM 属性。
 *
 * URL 同步断言靠 spy `window.history.replaceState`（jsdom 自带该方法）；
 * 装spy 前先用原生 replaceState 把地址定位到任务页，组件随后读到的
 * `window.location.href` 即 `/space/personal/tasks`。
 */

const TAB_SELECTOR = {
  board: '[data-testid="tasks-view-tab-board"]',
  list: '[data-testid="tasks-view-tab-list"]',
} as const;

const PANEL_SELECTOR = {
  board: '[data-testid="tasks-view-panel-board"]',
  list: '[data-testid="tasks-view-panel-list"]',
} as const;

let container: HTMLDivElement;
let root: Root;
let replaceStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, "", "/space/personal/tasks");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  replaceStateSpy = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  replaceStateSpy.mockRestore();
  vi.clearAllMocks();
});

function renderTabs(initialView: TasksView = "board"): void {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="zh" messages={zh}>
        <TasksViewTabs
          initialView={initialView}
          board={<div data-testid="slot-board">看板内容</div>}
          list={<div data-testid="slot-list">列表内容</div>}
        />
      </NextIntlClientProvider>,
    );
  });
}

function tab(name: TasksView): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(TAB_SELECTOR[name]);
  if (!element) throw new Error(`missing ${TAB_SELECTOR[name]}`);
  return element;
}

function panel(name: TasksView): HTMLElement {
  const element = container.querySelector<HTMLElement>(PANEL_SELECTOR[name]);
  if (!element) throw new Error(`missing ${PANEL_SELECTOR[name]}`);
  return element;
}

/** 最近一次 replaceState 调用的 URL（组件传的是 URL 对象，统一转字符串比对）。 */
function lastSyncedUrl(): string {
  const calls = replaceStateSpy.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error("replaceState was not called");
  return String(last[2]);
}

/**
 * layoutId 不落 DOM 属性（motion 消费掉），沿 React fiber 链向上找
 * memoizedProps 里的 layoutId——直接断言「渲染出的胶囊元素带该 prop」。
 */
type FiberLike = {
  memoizedProps?: Record<string, unknown>;
  return?: FiberLike | null;
};

function layoutIdOf(element: Element): unknown {
  const fiberKey = Object.keys(element).find((key) =>
    key.startsWith("__reactFiber$"),
  );
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

function click(element: HTMLElement): void {
  act(() => {
    element.click();
  });
}

function pressArrow(element: HTMLElement, key: "ArrowLeft" | "ArrowRight"): void {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

describe("TasksViewTabs（看板 / 列表双视图壳）", () => {
  it("initialView=board：board 面板可见，list 面板 inert + aria-hidden", () => {
    renderTabs("board");

    const board = panel("board");
    const list = panel("list");

    // 双面板常驻挂载：两个 slot 都在文档里。
    expect(container.querySelector('[data-testid="slot-board"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="slot-list"]')).not.toBeNull();

    // 激活面板：无 inert / aria-hidden / pointer-events-none。
    expect(board.hasAttribute("inert")).toBe(false);
    expect(board.getAttribute("aria-hidden")).toBeNull();
    expect(board.className).not.toContain("pointer-events-none");

    // 非激活面板：inert + aria-hidden="true" + pointer-events-none。
    expect(list.hasAttribute("inert")).toBe(true);
    expect(list.getAttribute("aria-hidden")).toBe("true");
    expect(list.className).toContain("pointer-events-none");
  });

  it("点击列表 tab：list 变可见、board 变 inert，URL 同步为 ?view=list", () => {
    renderTabs("board");

    click(tab("list"));

    expect(panel("list").hasAttribute("inert")).toBe(false);
    expect(panel("list").getAttribute("aria-hidden")).toBeNull();
    expect(panel("board").hasAttribute("inert")).toBe(true);
    expect(panel("board").getAttribute("aria-hidden")).toBe("true");
    expect(lastSyncedUrl()).toBe(
      "http://localhost:3000/space/personal/tasks?view=list",
    );
  });

  it("再点看板 tab：URL 的 view 参数被删除（回归默认看板地址）", () => {
    renderTabs("board");

    click(tab("list"));
    click(tab("board"));

    expect(lastSyncedUrl()).toBe("http://localhost:3000/space/personal/tasks");
  });

  it("tablist 语义 + roving tabindex + 方向键切换且焦点随迁", () => {
    renderTabs("board");

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tab("board").getAttribute("role")).toBe("tab");
    expect(tab("list").getAttribute("role")).toBe("tab");

    // 激活 tab：aria-selected=true、tabIndex=0；非激活：false、-1。
    expect(tab("board").getAttribute("aria-selected")).toBe("true");
    expect(tab("board").getAttribute("tabindex")).toBe("0");
    expect(tab("list").getAttribute("aria-selected")).toBe("false");
    expect(tab("list").getAttribute("tabindex")).toBe("-1");

    // ArrowRight：board → list，焦点迁到 list tab。
    act(() => {
      tab("board").focus();
    });
    pressArrow(tab("board"), "ArrowRight");
    expect(panel("list").hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(tab("list"));
    expect(tab("list").getAttribute("aria-selected")).toBe("true");
    expect(tab("list").getAttribute("tabindex")).toBe("0");
    expect(tab("board").getAttribute("tabindex")).toBe("-1");

    // ArrowLeft：list → board，焦点迁回 board tab。
    pressArrow(tab("list"), "ArrowLeft");
    expect(panel("board").hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(tab("board"));
    expect(tab("board").getAttribute("aria-selected")).toBe("true");
  });

  it("指示胶囊带共享 layoutId，随激活 tab 移动", () => {
    renderTabs("board");

    // 激活 tab 内渲染胶囊（aria-hidden 的 motion.span），非激活 tab 没有。
    const pillOnBoard = tab("board").querySelector('span[aria-hidden="true"]');
    expect(pillOnBoard).not.toBeNull();
    expect(tab("list").querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(layoutIdOf(pillOnBoard as Element)).toBe("tasks-view-active-pill");

    // 切到 list 后胶囊移到 list tab（同一 layoutId，两 tab 共享）。
    click(tab("list"));
    const pillOnList = tab("list").querySelector('span[aria-hidden="true"]');
    expect(pillOnList).not.toBeNull();
    expect(tab("board").querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(layoutIdOf(pillOnList as Element)).toBe("tasks-view-active-pill");
  });
});
