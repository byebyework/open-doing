/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { ProjectTasksList } from "./ProjectTasksList";

/** jsdom 探针：筛选写回 URL（保 tab 等参数）、"all" 删参、空标签池无下拉。 */
describe("ProjectTasksList", () => {
  let container: HTMLDivElement;
  let root: Root;
  let replaceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState(null, "", "/space/personal/projects/p?tab=tasks");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    replaceSpy = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    replaceSpy.mockRestore();
    window.history.replaceState(null, "", "/");
  });

  function render(
    tagOptions: { id: string; name: string }[] = [],
    milestoneOptions: { id: string; name: string }[] = [],
    initialFilters = { status: "all" as const, priority: "all" as const, tag: "all", milestone: "all" },
  ) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectTasksList
            initialFilters={initialFilters}
            tagOptions={tagOptions}
            milestoneOptions={milestoneOptions}
          >
            <div data-testid="table-slot">rows</div>
          </ProjectTasksList>
        </NextIntlClientProvider>,
      );
    });
  }

  function openAndClick(triggerTestid: string, optionTestid: string) {
    const trigger = container.querySelector<HTMLElement>(
      `[data-testid="${triggerTestid}"]`,
    );
    if (!trigger) throw new Error(`missing ${triggerTestid}`);
    act(() => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
    const option = document.body.querySelector<HTMLElement>(
      `[data-testid="${optionTestid}"]`,
    );
    if (!option) throw new Error(`missing ${optionTestid}`);
    act(() => {
      option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  function lastUrl(): string {
    const calls = replaceSpy.mock.calls;
    const last = calls[calls.length - 1];
    if (!last) throw new Error("replaceState was not called");
    return String(last[2]);
  }

  it("子表格照常渲染", () => {
    render();
    expect(container.querySelector('[data-testid="table-slot"]')).not.toBeNull();
  });

  it("选状态筛选：URL 写入 status 且保留 tab；改回全部则删参", () => {
    render();

    openAndClick("task-filter-status", "task-filter-status-option-in_progress");
    let url = new URL(lastUrl());
    expect(url.searchParams.get("status")).toBe("in_progress");
    expect(url.searchParams.get("tab")).toBe("tasks");

    openAndClick("task-filter-status", "task-filter-status-option-all");
    url = new URL(lastUrl());
    expect(url.searchParams.get("status")).toBeNull();
    expect(url.searchParams.get("tab")).toBe("tasks");
  });

  it("标签筛选写入 ?tag=；优先级同理", () => {
    render([{ id: "tag-9", name: "设计" }]);

    openAndClick("task-filter-tag", "task-filter-tag-option-tag-9");
    expect(new URL(lastUrl()).searchParams.get("tag")).toBe("tag-9");

    openAndClick("task-filter-priority", "task-filter-priority-option-high");
    expect(new URL(lastUrl()).searchParams.get("priority")).toBe("high");
  });

  it("幽灵 ?milestone=（选项里已不存在）在选项集合变化后回 all", () => {
    render(
      [],
      [{ id: "msB", name: "现存里程碑" }],
      { status: "all", priority: "all", tag: "all", milestone: "msGone" },
    );
    const trigger = container.querySelector('[data-testid="task-filter-milestone"]');
    // 初次挂载即触发派生同步：失效 id 回 all，触发器显示「全部」且非激活态。
    expect(trigger?.textContent).toContain("全部");
    expect(trigger?.className).not.toContain("border-[var(--primary)]");
  });

  it("选里程碑写入 ?milestone=，改回全部删参，tab 保留", () => {
    render([], [{ id: "ms-9", name: "上线" }]);

    openAndClick("task-filter-milestone", "task-filter-milestone-option-ms-9");
    let url = new URL(lastUrl());
    expect(url.searchParams.get("milestone")).toBe("ms-9");
    expect(url.searchParams.get("tab")).toBe("tasks");

    openAndClick("task-filter-milestone", "task-filter-milestone-option-all");
    url = new URL(lastUrl());
    expect(url.searchParams.get("milestone")).toBeNull();
    expect(url.searchParams.get("tab")).toBe("tasks");
  });

  it("空标签池：不渲染标签下拉", () => {
    render([]);
    expect(container.querySelector('[data-testid="task-filter-tag"]')).toBeNull();
  });
});
