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
import { listTeamProjectMilestonesAction, updateTeamProjectStatusAction } from "../actions";
import { filterProjectRows, ProjectListTable, type ProjectListRow } from "./ProjectListTable";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    listTeamProjectMilestonesAction: vi.fn(),
    updateTeamProjectStatusAction: vi.fn(),
  };
});

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
    status: "in_progress",
    lead: { id: "m1", name: "负责人甲", image: null },
    members: [{ id: "m1", name: "负责人甲", image: null }],
    progressPercent: 65,
    milestoneCount: 1,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    taskCount: 12,
    doneCount: 7,
    overdueCount: 1,
  },
  {
    id: "b",
    name: "Beta 工作流",
    href: "/space/growth/projects/beta",
    priority: "medium",
    tags: [],
    status: "backlog",
    lead: null,
    members: [],
    progressPercent: 0,
    milestoneCount: 0,
    taskCount: 0,
    doneCount: 0,
    overdueCount: 0,
  },
  {
    id: "c",
    name: "Gamma 监控",
    href: "/space/growth/projects/gamma",
    priority: "low",
    tags: [tag("t1", "核心目标"), tag("t2", "日常维护")],
    status: "completed",
    lead: null,
    members: [],
    progressPercent: 100,
    milestoneCount: 2,
    taskCount: 5,
    doneCount: 5,
    overdueCount: 0,
  },
];

describe("filterProjectRows（纯函数）", () => {
  it("默认无筛选返回全部行", () => {
    expect(filterProjectRows(rows, { status: "all", priority: "all", tagId: "all", keyword: "" })).toHaveLength(3);
  });

  it("状态筛选：in_progress 只剩 Alpha；backlog 只剩 Beta", () => {
    const result = filterProjectRows(rows, { status: "in_progress", priority: "all", tagId: "all", keyword: "" });
    expect(result.map((r) => r.id)).toEqual(["a"]);
    const backlog = filterProjectRows(rows, { status: "backlog", priority: "all", tagId: "all", keyword: "" });
    expect(backlog.map((r) => r.id)).toEqual(["b"]);
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

  function renderTablePersonal(inputRows: ProjectListRow[]) {
    vi.mocked(listTeamProjectMilestonesAction).mockResolvedValue({ ok: true, data: [] });
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectListTable rows={inputRows} space={{ kind: "personal" }} canManage />
        </NextIntlClientProvider>,
      );
    });
  }

  function click(testid: string) {
    const button = document.body.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
    if (!button) throw new Error(`missing button ${testid}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function renderTable(inputRows: ProjectListRow[], canManage = true) {
    vi.mocked(listTeamProjectMilestonesAction).mockResolvedValue({ ok: true, data: [] });
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectListTable
            rows={inputRows}
            space={{ kind: "team", teamId: "66666666-6666-6666-6666-666666666666" }}
            canManage={canManage}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function queryAll(testid: string) {
    return document.body.querySelectorAll(`[data-testid="${testid}"]`);
  }

  function clickButton(selector: string) {
    const button = document.body.querySelector<HTMLElement>(selector);
    if (!button) throw new Error(`missing button ${selector}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("默认渲染全部行；点击名称打开右侧 Drawer（含完整页入口）", async () => {
    renderTable(rows);
    expect(queryAll("project-row")).toHaveLength(3);

    clickButton('[data-testid="project-row-0"] button');
    await act(async () => {});
    await act(async () => {});

    const drawer = document.body.querySelector('[data-testid="project-detail-drawer"]');
    expect(drawer).not.toBeNull();
    const link = drawer!.querySelector<HTMLAnchorElement>('[data-testid="project-drawer-full-page-link"]');
    expect(link?.getAttribute("href")).toBe("/space/growth/projects/alpha");
  });

  it("团队表格 7 列头（负责人/截止时间/任务数在列）", () => {
    renderTable(rows);
    const headers = Array.from(document.body.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers.some((h) => h?.includes("负责人"))).toBe(true);
    expect(headers.some((h) => h?.includes("截止时间"))).toBe(true);
    expect(headers.some((h) => h?.includes("任务数"))).toBe(true);
    expect(headers.some((h) => h?.includes("标签"))).toBe(false);
    expect(headers.some((h) => h?.includes("里程碑"))).toBe(false);
    // 负责人单元格渲染头像+名
    expect(document.body.textContent).toContain("负责人甲");
  });

  it("个人空间 6 列（无负责人列）", () => {
    renderTablePersonal(rows);
    const headers = Array.from(document.body.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers.some((h) => h?.includes("负责人"))).toBe(false);
  });

  it("状态就地改：pill 选项点击调用 status action", async () => {
    vi.mocked(updateTeamProjectStatusAction).mockResolvedValue({
      ok: true,
      data: { ...rows[0]!, tags: undefined, lead: null, members: [] } as never,
    });
    renderTable(rows);
    click(`project-status-pill-a`);
    click("project-status-option-canceled");
    await act(async () => {});
    await act(async () => {});
    expect(updateTeamProjectStatusAction).toHaveBeenCalledWith({
      teamId: "66666666-6666-6666-6666-666666666666",
      projectId: "a",
      status: "canceled",
    });
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

  it("整行可点：点击行内非链接单元格打开 Drawer", async () => {
    renderTable(rows);
    // 点状态 pill 所在单元格（非名称按钮区）。
    const row = document.body.querySelectorAll('[data-testid="project-row"]')[0];
    const cell = row?.querySelector<HTMLTableCellElement>("td:nth-child(4)");
    if (!cell) throw new Error("missing status cell");
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(
      document.body.querySelector('[data-testid="project-detail-drawer"]'),
    ).not.toBeNull();
  });

  it("分页：11 行时第 1 页 10 行，翻页见余行；筛选变化重置页码", async () => {
    const many: ProjectListRow[] = Array.from({ length: 11 }, (_, i) => ({
      id: `p${i}`,
      name: `项目 ${i}`,
      href: `/space/growth/projects/p${i}`,
      priority: "medium",
      tags: [],
      status: "backlog",
      lead: null,
      members: [],
      progressPercent: 0,
      milestoneCount: 0,
      taskCount: 0,
      doneCount: 0,
      overdueCount: 0,
    }));
    renderTable(many);
    expect(queryAll("project-row")).toHaveLength(10);
    expect(document.body.querySelector('[data-testid="project-page-prev"]')).not.toBeNull();
    expect(document.body.textContent).toContain("共 11 个");

    clickButton('[data-testid="project-page-next"]');
    expect(queryAll("project-row")).toHaveLength(1);

    // 筛选变化重置回第 1 页
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="project-search-input"]');
    if (!input) throw new Error("missing search input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "项目 1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // 关键字命中 2 个（1、10），重置后第 1 页全见
    expect(queryAll("project-row")).toHaveLength(2);
  });

  it("截止时间/任务数列渲染", () => {
    renderTable(rows);
    expect(document.body.textContent).toContain("2026-11-30");
    expect(document.body.textContent).toContain("12");
  });
});
