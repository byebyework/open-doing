/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, searchParamsMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn<(url: string) => void>(),
  searchParamsMock: vi.fn<() => URLSearchParams>(() => new URLSearchParams()),
  pathnameMock: vi.fn<() => string>(() => "/space/personal/tasks"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => searchParamsMock(),
  usePathname: () => pathnameMock(),
}));

import zh from "@/i18n/messages/zh.json";

const { TaskProjectFilter } = await import("./TaskProjectFilter");

const PROJECTS = [
  { id: "proj-a", name: "项目A", slug: "project-a" },
  { id: "proj-b", name: "项目B", slug: "project-b" },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(ui: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale="zh" messages={zh}>
        {ui}
      </NextIntlClientProvider>,
    );
  });
  return host;
}

function trigger(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    '[data-testid="task-filter-project"]',
  );
}

function openMenu(): void {
  const t = trigger();
  if (!t) throw new Error("missing project filter trigger");
  act(() => {
    t.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  });
}

function clickOption(testid: string): void {
  const option = document.body.querySelector<HTMLElement>(
    `[data-testid="${testid}"]`,
  );
  if (!option) throw new Error(`missing option ${testid}`);
  act(() => {
    option.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

function lastPushedUrl(): string {
  const last = pushMock.mock.calls[pushMock.mock.calls.length - 1];
  if (!last) throw new Error("router.push was not called");
  return String(last[0]);
}

beforeEach(() => {
  pushMock.mockClear();
  searchParamsMock.mockReturnValue(new URLSearchParams());
  pathnameMock.mockReturnValue("/space/personal/tasks");
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
});

describe("TaskProjectFilter（URL 驱动的项目筛选）", () => {
  it("初始无 ?project=：触发器显示「全部」，不高亮", () => {
    render(<TaskProjectFilter projects={PROJECTS} />);

    const t = trigger();
    expect(t).not.toBeNull();
    expect(t?.textContent).toContain(zh.kanban.filterProjectLabel);
    expect(t?.textContent).toContain(zh.kanban.filterAll);
    expect(t?.className).not.toContain("border-[var(--primary)]");
  });

  it("选中项目：push URL 写入 project= 并保留 view 与统计参数", () => {
    searchParamsMock.mockReturnValue(
      new URLSearchParams("view=list&status=todo"),
    );
    render(<TaskProjectFilter projects={PROJECTS} />);

    openMenu();
    clickOption("task-filter-project-option-project-b");

    const url = new URL(lastPushedUrl(), "http://localhost");
    expect(url.pathname).toBe("/space/personal/tasks");
    expect(url.searchParams.get("project")).toBe("project-b");
    expect(url.searchParams.get("view")).toBe("list");
    expect(url.searchParams.get("status")).toBe("todo");
  });

  it("已有 ?project= 时选「全部」：push URL 删除 project= 并保留其余参数", () => {
    searchParamsMock.mockReturnValue(
      new URLSearchParams("project=project-a&view=list"),
    );
    render(<TaskProjectFilter projects={PROJECTS} />);

    expect(trigger()?.textContent).toContain("项目A");

    openMenu();
    clickOption("task-filter-project-option-all");

    const url = new URL(lastPushedUrl(), "http://localhost");
    expect(url.searchParams.get("project")).toBeNull();
    expect(url.searchParams.get("view")).toBe("list");
  });

  it("projectProgress 提供时选项文本带 · NN%（团队进度提示迁移）", () => {
    render(
      <TaskProjectFilter
        projects={PROJECTS}
        projectProgress={{ "project-a": 0.4 }}
        allProjectsProgress={0.25}
      />,
    );

    openMenu();
    const optionA = document.body.querySelector(
      '[data-testid="task-filter-project-option-project-a"]',
    );
    expect(optionA?.textContent).toContain("项目A");
    expect(optionA?.textContent).toContain("· 40%");
    const allOption = document.body.querySelector(
      '[data-testid="task-filter-project-option-all"]',
    );
    expect(allOption?.textContent).toContain("· 25%");
  });

  it("projects 为空：不渲染（零项目空间沿用上轮裁定）", () => {
    const hostEl = render(<TaskProjectFilter projects={[]} />);

    expect(hostEl.querySelector('[data-testid="task-filter-project"]')).toBeNull();
  });

  it("无效 slug（RSC 已回退全部）：触发器显示「全部」且不高亮，不暴露 URL 原文", () => {
    searchParamsMock.mockReturnValue(
      new URLSearchParams("project=not-a-real-project"),
    );
    render(<TaskProjectFilter projects={PROJECTS} />);

    const t = trigger();
    expect(t?.textContent).toContain(zh.kanban.filterAll);
    expect(t?.textContent).not.toContain("not-a-real-project");
    expect(t?.className).not.toContain("border-[var(--primary)]");
  });
});
