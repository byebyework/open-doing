/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TaskProjectFilter（tab 行右侧）读路径/参数拼 push URL；本文件只断言
// DOM 形态，push 行为在 TaskProjectFilter.test.tsx 里专测。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/space/personal/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

import en from "@/i18n/messages/en.json";
import zh from "@/i18n/messages/zh.json";

import { useListFilters } from "../list-filters-context";
import { filterTaskRows } from "../sort-task-rows";
import { TasksViewTabs, type TasksView } from "./TasksViewTabs";

/** 筛选下拉依赖的项目池（id/name/slug，页面同款形状）。 */
const PROJECTS = [
  { id: "proj-a", name: "项目A", slug: "project-a" },
  { id: "proj-b", name: "项目B", slug: "project-b" },
];

const FILTER_SELECTOR = {
  status: '[data-testid="task-filter-status"]',
  priority: '[data-testid="task-filter-priority"]',
} as const;

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

function renderTabs(
  initialView: TasksView = "board",
  projects?: { id: string; name: string; slug: string }[],
  listSlot: ReactNode = <div data-testid="slot-list">列表内容</div>,
): void {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="zh" messages={zh}>
        <TasksViewTabs
          initialView={initialView}
          projects={projects}
          board={<div data-testid="slot-board">看板内容</div>}
          list={listSlot}
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

function filterTrigger(field: keyof typeof FILTER_SELECTOR): HTMLElement | null {
  return container.querySelector<HTMLElement>(FILTER_SELECTOR[field]);
}

/** 列表槽探针夹具：一行 todo、一行 done，供 filterTaskRows 演示行收窄。 */
const PROBE_ROWS = [
  { status: "todo" as const, priority: "high" as const, projectId: "proj-a" },
  { status: "done" as const, priority: "low" as const, projectId: "proj-b" },
];

/**
 * 列表槽探针：读 provider 的筛选 state，并用 filterTaskRows 算可见行数，
 * 让「切 tab 重置筛选」同时钉住 state 与派生的行结果（不限触发器文案）。
 */
function FilterProbe() {
  const { filters } = useListFilters();
  return (
    <div>
      <span data-testid="filter-probe-status">{filters.status}</span>
      <span data-testid="filter-probe-rows">
        {filterTaskRows(PROBE_ROWS, filters).length}
      </span>
    </div>
  );
}

function probeStatus(): string | null {
  return (
    container.querySelector('[data-testid="filter-probe-status"]')
      ?.textContent ?? null
  );
}

function probeRowCount(): number | null {
  const text = container.querySelector('[data-testid="filter-probe-rows"]')
    ?.textContent;
  return text ? Number(text) : null;
}

/** 打开筛选下拉（Radix DropdownMenu 由 pointerdown 触发）。 */
function openFilterMenu(field: keyof typeof FILTER_SELECTOR): void {
  const trigger = filterTrigger(field);
  if (!trigger) throw new Error(`missing ${field} filter trigger`);
  act(() => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  });
}

/** 点选筛选菜单项；菜单挂在 document.body（portal）。 */
function clickFilterOption(
  field: keyof typeof FILTER_SELECTOR,
  value: string,
): void {
  const option = document.body.querySelector<HTMLElement>(
    `[data-testid="task-filter-${field}-option-${value}"]`,
  );
  if (!option) throw new Error(`missing ${field} option ${value}`);
  act(() => {
    option.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
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

    // 激活面板留在文档流（撑起容器高度）；非激活面板 absolute 脱离高度。
    expect(board.className).not.toContain("absolute");
    expect(list.className).toContain("absolute");
    expect(board.parentElement?.className).toBe("relative");
  });

  it("点击列表 tab：list 变可见、board 变 inert，URL 同步为 ?view=list", () => {
    renderTabs("board");

    click(tab("list"));

    expect(panel("list").hasAttribute("inert")).toBe(false);
    expect(panel("list").getAttribute("aria-hidden")).toBeNull();
    expect(panel("board").hasAttribute("inert")).toBe(true);
    expect(panel("board").getAttribute("aria-hidden")).toBe("true");
    // 流式/absolute 随之互换：容器高度改由列表视图决定。
    expect(panel("list").className).not.toContain("absolute");
    expect(panel("board").className).toContain("absolute");
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

  it("列表视图：tab 行右侧渲染状态 / 优先级 / 项目三个筛选触发器（label + 全部）", () => {
    renderTabs("list", PROJECTS);

    expect(filterTrigger("status"), "missing status filter").not.toBeNull();
    expect(filterTrigger("priority"), "missing priority filter").not.toBeNull();
    expect(
      document.querySelector('[data-testid="task-filter-project"]'),
      "missing project filter",
    ).not.toBeNull();

    // 触发器文案 = 标签 + 当前值；初始均为「全部」。
    expect(filterTrigger("status")?.textContent).toContain(
      zh.kanban.filterStatusLabel,
    );
    expect(filterTrigger("priority")?.textContent).toContain(
      zh.kanban.filterPriorityLabel,
    );
    expect(
      document.querySelector('[data-testid="task-filter-project"]')
        ?.textContent,
    ).toContain(zh.kanban.filterAll);

    // 折行容器：375px 下筛选组落到 tab 行下方。
    expect(filterTrigger("status")?.closest(".flex-wrap")).not.toBeNull();
  });

  it("项目筛选两视图常驻：看板视图只有项目下拉，列表视图三者齐全", () => {
    renderTabs("board", PROJECTS);

    // 看板视图：项目筛选保留（URL 驱动，服务端过滤两视图），本地状态 /
    // 优先级筛选不出现。
    expect(
      document.querySelector('[data-testid="task-filter-project"]'),
    ).not.toBeNull();
    expect(filterTrigger("status")).toBeNull();
    expect(filterTrigger("priority")).toBeNull();

    click(tab("list"));
    expect(filterTrigger("status")).not.toBeNull();
    expect(filterTrigger("priority")).not.toBeNull();
    expect(
      document.querySelector('[data-testid="task-filter-project"]'),
    ).not.toBeNull();

    click(tab("board"));
    expect(filterTrigger("status")).toBeNull();
    expect(
      document.querySelector('[data-testid="task-filter-project"]'),
    ).not.toBeNull();
  });

  it("零项目空间（未传 projects / 空数组）：状态 + 优先级照常渲染，项目下拉不渲染", () => {
    // 个人空间可只有散任务而无项目：本地筛选组不得整体消失，否则连状态 /
    // 优先级都无法筛选（生产回归：曾经按 projects?.length 整体门控）。
    const projectPools: ({ id: string; name: string; slug: string }[] | undefined)[] =
      [undefined, []];
    for (const projects of projectPools) {
      renderTabs("list", projects);

      expect(filterTrigger("status")).not.toBeNull();
      expect(filterTrigger("priority")).not.toBeNull();
      expect(
        document.querySelector('[data-testid="task-filter-project"]'),
      ).toBeNull();
      // 状态 / 优先级初始值仍为「全部」。
      expect(filterTrigger("status")?.textContent).toContain(zh.kanban.filterAll);
      expect(filterTrigger("priority")?.textContent).toContain(
        zh.kanban.filterAll,
      );
    }
  });

  it("切换 tab 重置本地筛选：状态筛选在看板 ↔ 列表往返后归零", () => {
    renderTabs("list", PROJECTS, <FilterProbe />);

    // 初始：筛选为「全部」，两行都在。
    expect(filterTrigger("status")?.textContent).toContain(zh.kanban.filterAll);
    expect(probeStatus()).toBe("all");
    expect(probeRowCount()).toBe(2);

    openFilterMenu("status");
    clickFilterOption("status", "todo");

    // 选中待办：触发器不再显示「全部」，探针只剩待办那一行。
    expect(filterTrigger("status")?.textContent).not.toContain(
      zh.kanban.filterAll,
    );
    expect(filterTrigger("status")?.textContent).toContain(zh.kanban.colTodo);
    expect(probeStatus()).toBe("todo");
    expect(probeRowCount()).toBe(1);

    // 切到看板（重置筛选）再切回列表：触发器回到「全部」，行恢复全量。
    click(tab("board"));
    click(tab("list"));

    expect(filterTrigger("status")?.textContent).toContain(zh.kanban.filterAll);
    expect(probeStatus()).toBe("all");
    expect(probeRowCount()).toBe(2);
  });

  it("筛选文案键在 zh / en 消息包中都存在", () => {
    expect(zh.kanban.filterStatusLabel).toBe("状态");
    expect(zh.kanban.filterPriorityLabel).toBe("优先级");
    expect(zh.kanban.filterProjectLabel).toBe("项目");
    expect(zh.kanban.filterAll).toBe("全部");
    expect(en.kanban.filterStatusLabel).toBe("Status");
    expect(en.kanban.filterPriorityLabel).toBe("Priority");
    expect(en.kanban.filterProjectLabel).toBe("Project");
    expect(en.kanban.filterAll).toBe("All");
  });
});
