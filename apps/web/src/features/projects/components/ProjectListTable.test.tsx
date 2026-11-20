/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Tag } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { vi } from "vitest";
import { filterProjectRows, ProjectListTable, type ProjectListRow } from "./ProjectListTable";

vi.mock("next/navigation", () => {
  const push = vi.fn();
  return { useRouter: () => ({ push }) };
});

import { useRouter } from "next/navigation";

/**
 * 仓库 vitest 是 node 环境的 jsdom 探针写法（同 ProjectStatsCard.test.tsx）。
 *
 * 筛选逻辑（状态/优先级/标签/关键字/叠加）走导出的纯函数 `filterProjectRows`
 * 全面单测（Radix Select 在 jsdom 探针下难以稳定驱动）；DOM 层覆盖状态 tabs
 * 点击、关键字过滤、筛选空集 filterEmpty、行链接 href。
 */
function tag(id: string, name: string): Tag {
  return {
    id,
    teamId: null,
    ownerId: null,
    name,
    color: "purple",
    type: "project",
    updatedAt: "",
    createdAt: "",
  };
}

const rows: ProjectListRow[] = [
  {
    id: "a",
    name: "Alpha 重构",
    description: "支持目标标签与任务标签独立管理",
    href: "/space/growth/projects/alpha",
    priority: "high",
    tags: [tag("t1", "核心目标")],
    statusKind: "in_progress",
    progressPercent: 65,
    milestoneCount: 1,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  },
  {
    id: "b",
    name: "Beta 工作流",
    href: "/space/growth/projects/beta",
    priority: "medium",
    tags: [],
    statusKind: "not_started",
    progressPercent: 0,
    milestoneCount: 0,
  },
  {
    id: "c",
    name: "Gamma 监控",
    href: "/space/growth/projects/gamma",
    priority: "low",
    tags: [tag("t1", "核心目标"), tag("t2", "日常维护")],
    statusKind: "completed",
    progressPercent: 100,
    milestoneCount: 2,
  },
];

describe("filterProjectRows（纯函数）", () => {
  it("默认无筛选返回全部行", () => {
    expect(filterProjectRows(rows, { status: "all", priority: "all", tagId: "all", keyword: "" })).toHaveLength(3);
  });

  it("状态筛选：in_progress 只剩 Alpha", () => {
    const result = filterProjectRows(rows, { status: "in_progress", priority: "all", tagId: "all", keyword: "" });
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("优先级筛选：high 只剩 Alpha；medium 只剩 Beta", () => {
    expect(
      filterProjectRows(rows, { status: "all", priority: "high", tagId: "all", keyword: "" }).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      filterProjectRows(rows, { status: "all", priority: "medium", tagId: "all", keyword: "" }).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("标签筛选：核心目标剩 Alpha、Gamma", () => {
    expect(
      filterProjectRows(rows, { status: "all", priority: "all", tagId: "t1", keyword: "" }).map((r) => r.id),
    ).toEqual(["a", "c"]);
  });

  it("关键字不区分大小写匹配名称", () => {
    expect(
      filterProjectRows(rows, { status: "all", priority: "all", tagId: "all", keyword: "alpha" }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("多条件叠加：high + in_progress + t1 + 命中关键字", () => {
    const hit = filterProjectRows(rows, { status: "in_progress", priority: "high", tagId: "t1", keyword: "重构" });
    expect(hit.map((r) => r.id)).toEqual(["a"]);

    const none = filterProjectRows(rows, { status: "completed", priority: "high", tagId: "t1", keyword: "" });
    expect(none).toEqual([]);
  });
});

describe("ProjectListTable（DOM 探针）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderTable(inputRows: ProjectListRow[]) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectListTable rows={inputRows} />
        </NextIntlClientProvider>,
      );
    });
  }

  function queryAll(testid: string) {
    return document.body.querySelectorAll(`[data-testid="${testid}"]`);
  }

  it("默认渲染全部行；行名称是指向 href 的链接", () => {
    renderTable(rows);
    expect(queryAll("project-row")).toHaveLength(3);
    const link = document.body.querySelector<HTMLAnchorElement>('[data-testid="project-row-0"] a');
    expect(link?.getAttribute("href")).toBe("/space/growth/projects/alpha");
  });

  it("点击状态 tab「进行中」过滤行", () => {
    renderTable(rows);
    const trigger = document.body.querySelector<HTMLButtonElement>('[data-testid="project-status-tab-in_progress"]');
    if (!trigger) throw new Error("missing in_progress tab");
    act(() => {
      // Radix TabsTrigger 在 pointerdown/mousedown 上激活，click 单发不够。
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(queryAll("project-row")).toHaveLength(1);
  });

  it("关键字搜索过滤行", () => {
    renderTable(rows);
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="project-search-input"]');
    if (!input) throw new Error("missing search input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "gamma");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(queryAll("project-row")).toHaveLength(1);
  });

  it("叠加筛选后空集渲染 filterEmpty 提示行", () => {
    renderTable(rows);
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="project-search-input"]');
    if (!input) throw new Error("missing search input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "不存在的项目");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(queryAll("project-row")).toHaveLength(0);
    expect(document.body.querySelector('[data-testid="project-filter-empty"]')).not.toBeNull();
  });

  it("整行可点：点击行内非链接单元格导航到项目详情", async () => {
    renderTable(rows);
    const push = vi.mocked(useRouter().push);
    // 点状态 pill 所在单元格（非名称链接区）。
    const row = document.body.querySelectorAll('[data-testid="project-row"]')[0];
    const cell = row?.querySelector<HTMLTableCellElement>("td:nth-child(4)");
    if (!cell) throw new Error("missing status cell");
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(push).toHaveBeenCalledWith("/space/growth/projects/alpha");
  });

  it("里程碑 0 显示「-」，非 0 显示 N 个节点", () => {
    renderTable(rows);
    expect(document.body.textContent).toContain("1 个节点");
    expect(document.body.textContent).toContain("2 个节点");
    expect(document.body.textContent).toContain("-");
  });
});
