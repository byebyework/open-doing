/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tag, TaskPriority, TaskStatus } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

/**
 * 空间级任务表格探针：jsdom + React 官方 act 的最小探针写法
 * （仓库 vitest 是 node 环境、无 @testing-library）。
 * Server Actions 与 sonner 走 vi.hoisted mock，断言入参形状与回滚路径。
 */

const {
  refresh,
  updatePersonalTaskAction,
  updateTeamTaskAction,
  toastError,
} = vi.hoisted(() => ({
  refresh: vi.fn(),
  updatePersonalTaskAction: vi.fn(),
  updateTeamTaskAction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) =>
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href={props.href}>{props.children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

vi.mock("@/features/personal/tasks/actions", () => ({
  updatePersonalTaskAction,
}));

vi.mock("@/features/tasks/actions", () => ({
  updateTeamTaskAction,
}));

import type { KanbanCardItem, TeamKanbanCardItem } from "../service";

const { SpaceTaskTable } = await import("./SpaceTaskTable");
const { sortTaskRows, DEFAULT_LIST_FILTERS } = await import("../sort-task-rows");
const { ListFiltersProvider } = await import("../list-filters-context");

const tag: Tag = {
  id: "tag-1",
  teamId: null,
  ownerId: null,
  name: "设计",
  color: "purple",
  type: "task",
  updatedAt: "2026-11-01T00:00:00.000Z",
  createdAt: "2026-11-01T00:00:00.000Z",
};

function personalRow(overrides: Partial<KanbanCardItem>): KanbanCardItem {
  return {
    id: "row-1",
    title: "任务",
    status: "todo",
    priority: "medium",
    dueDate: null,
    projectId: "proj-1",
    projectName: "官网改版",
    subtaskTotal: 0,
    subtaskDone: 0,
    completedAt: null,
    tags: [],
    ...overrides,
  };
}

/** 排序断言夹具：A(11-20 高) < D(11-20 中) < B(11-25 低) < C(无截止)。 */
const rowA = personalRow({
  id: "row-a",
  title: "任务A",
  priority: "high",
  dueDate: "2026-11-20",
  subtaskTotal: 2,
  subtaskDone: 1,
  tags: [tag],
});
const rowB = personalRow({ id: "row-b", title: "任务B", priority: "low", dueDate: "2026-11-25" });
const rowC = personalRow({ id: "row-c", title: "任务C", dueDate: null });
const rowD = personalRow({ id: "row-d", title: "任务D", dueDate: "2026-11-20" });

const TODAY = "2026-11-22";

describe("sortTaskRows（截止升序 + null 最后 + 同日优先级）", () => {
  const row = (dueDate: string | null, priority: TaskPriority) => ({
    dueDate,
    priority,
  });

  it("dueDate 升序、null 排最后", () => {
    const rows = [row(null, "low"), row("2026-11-25", "low"), row("2026-11-20", "low"), row(null, "high")];

    const sorted = sortTaskRows(rows);

    expect(sorted.map((item) => item.dueDate)).toEqual([
      "2026-11-20",
      "2026-11-25",
      null,
      null,
    ]);
  });

  it("同日期按优先级 high > medium > low", () => {
    const rows = [
      row("2026-11-20", "low"),
      row("2026-11-20", "high"),
      row("2026-11-20", "medium"),
    ];

    expect(sortTaskRows(rows).map((item) => item.priority)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("其余平局保持输入顺序（稳定），且不改动入参数组", () => {
    const first = row("2026-11-20", "high");
    const second = row("2026-11-20", "high");
    const late = row("2026-12-01", "low");
    const input = [second, first, late];

    const sorted = sortTaskRows(input);

    expect(sorted).toEqual([first, second, late]);
    expect(input).toEqual([second, first, late]);
  });
});

describe("SpaceTaskTable（个人 / 团队列表视图）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderTable(ui: React.ReactElement): void {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          {ui}
        </NextIntlClientProvider>,
      );
    });
  }

  function renderPersonal(rows: KanbanCardItem[] = [rowA, rowB, rowC, rowD]): void {
    renderTable(
      <SpaceTaskTable
        variant="personal"
        rows={rows}
        today={TODAY}
        taskHrefs={{
          [rowA.id]: `/personal/tasks/${rowA.id}`,
          [rowB.id]: `/personal/tasks/${rowB.id}`,
          [rowC.id]: `/personal/tasks/${rowC.id}`,
          [rowD.id]: `/personal/tasks/${rowD.id}`,
        }}
      />,
    );
  }

  function renderTeam(
    rows: TeamKanbanCardItem[] = [
      {
        ...rowA,
        assigneeId: "user-1",
        assigneeName: "王工",
      },
      { ...rowB, id: "row-u", title: "任务U", assigneeId: null, assigneeName: null },
    ],
    access: { role?: "owner" | "admin" | "member"; actorId?: string } = {},
  ): void {
    renderTable(
      <SpaceTaskTable
        variant="team"
        rows={rows}
        today={TODAY}
        taskHrefs={{ [rowA.id]: `/team/projects/site/tasks/${rowA.id}` }}
        teamId="team-1"
        teamSlug="site"
        role={access.role ?? "owner"}
        actorId={access.actorId ?? "user-1"}
      />,
    );
  }

  function renderPersonalWithFilters(
    filters: typeof DEFAULT_LIST_FILTERS,
    rows: KanbanCardItem[] = [rowA, rowB, rowC, rowD],
  ): void {
    renderTable(
      <ListFiltersProvider value={{ filters, setFilter: () => {}, projects: [] }}>
        <SpaceTaskTable
          variant="personal"
          rows={rows}
          today={TODAY}
          taskHrefs={{}}
        />
      </ListFiltersProvider>,
    );
  }

  function headers(): (string | null)[] {
    return Array.from(document.querySelectorAll("th")).map((th) => th.textContent);
  }

  function bodyRows(): HTMLTableRowElement[] {
    return Array.from(document.querySelectorAll("tbody tr"));
  }

  function statusPills(): HTMLButtonElement[] {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="task-status-pill"]',
      ),
    );
  }

  /** 打开某一行的状态菜单（Radix DropdownMenu 由 pointerdown 触发）。 */
  function openStatusMenu(rowIndex = 0): void {
    const pill = bodyRows()[rowIndex]?.querySelector<HTMLButtonElement>(
      '[data-testid="task-status-pill"]',
    );
    if (!pill) throw new Error(`missing status pill at row ${rowIndex}`);
    act(() => {
      pill.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
  }

  /** 点击菜单项；调用方自行包 act（需要等待 action promise 时用 async act）。 */
  function clickStatusItem(status: TaskStatus): void {
    const item = document.body.querySelector<HTMLElement>(
      `[data-testid="task-status-button-${status}"]`,
    );
    if (!item) throw new Error(`missing status menu item ${status}`);
    item.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }

  it("个人列表：7 列无操作列，行按排序输出", () => {
    renderPersonal();

    expect(headers()).toEqual([
      zh.tasks.colTask,
      zh.tasks.projectLabel,
      zh.tags.tagNameLabel,
      zh.tasks.priority,
      zh.tasks.statusLabel,
      zh.tasks.colProgress,
      zh.tasks.dueDateLabel,
    ]);

    const titles = Array.from(
      document.querySelectorAll("tbody tr td:first-child"),
    ).map((td) => td.textContent);
    expect(titles).toEqual(["任务A", "任务D", "任务B", "任务C"]);
  });

  it("标题是 <a href={taskHrefs[id]}>，文本为任务标题", () => {
    renderPersonal();

    const link = document.querySelector("tbody tr td:first-child a");
    expect(link?.getAttribute("href")).toBe(`/personal/tasks/${rowA.id}`);
    expect(link?.textContent).toBe("任务A");
  });

  it("显示项目名 pill 与标签 pills", () => {
    renderPersonal();

    const projectCell = document.querySelector(
      "tbody tr:first-child td:nth-child(2)",
    );
    expect(projectCell?.querySelector(".rounded-full")?.textContent).toBe(
      "官网改版",
    );

    const tagPills = document.querySelectorAll(
      "tbody tr:first-child [data-testid=\"tag-pill\"]",
    );
    expect(tagPills).toHaveLength(1);
    expect(tagPills[0]?.textContent).toBe("设计");
  });

  it("子任务进度文案用 tasks.tableSubtasksProgress（1/2 子任务 · 50%）", () => {
    renderPersonal();

    expect(document.body.textContent).toContain("1/2 子任务 · 50%");
  });

  it("截止列照抄 board 的 DueLabel 口径（逾期红 / 无截止占位，用 today prop）", () => {
    renderPersonal();

    const dueCells = Array.from(
      document.querySelectorAll("tbody tr td:last-child"),
    ).map((td) => td.textContent);
    expect(dueCells).toEqual([
      "2026-11-20 · 已逾期 2 天",
      "2026-11-20 · 已逾期 2 天",
      "2026-11-25",
      "—",
    ]);
    expect(
      document.querySelector("tbody tr:first-child td:last-child .text-\\[var\\(--status-overdue\\)\\]"),
    ).not.toBeNull();
  });

  it("团队列表：状态后插入负责人列，未指派显示 tasks.unassigned", () => {
    renderTeam();

    expect(headers()).toEqual([
      zh.tasks.colTask,
      zh.tasks.projectLabel,
      zh.tags.tagNameLabel,
      zh.tasks.priority,
      zh.tasks.statusLabel,
      zh.tasks.assigneeLabel,
      zh.tasks.colProgress,
      zh.tasks.dueDateLabel,
    ]);
    expect(document.body.textContent).toContain("王工");
    expect(document.body.textContent).toContain(zh.tasks.unassigned);
  });

  it("rows 为空：渲染 EmptyState（kanban.listEmptyTitle / listEmptyDescription）", () => {
    renderPersonal([]);

    expect(
      document.querySelector('[data-testid="space-task-table"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain(zh.kanban.listEmptyTitle);
    expect(document.body.textContent).toContain(zh.kanban.listEmptyDescription);
  });

  it("状态列：每行单个 pill，文本为当前状态；可编辑行 pill 可点", () => {
    renderPersonal([
      personalRow({
        id: "r-todo",
        title: "待办行",
        status: "todo",
        dueDate: "2026-11-20",
      }),
      personalRow({
        id: "r-progress",
        title: "进行行",
        status: "in_progress",
        dueDate: "2026-11-21",
      }),
      personalRow({
        id: "r-done",
        title: "完成行",
        status: "done",
        dueDate: "2026-11-22",
      }),
    ]);

    const pills = statusPills();
    expect(pills).toHaveLength(3);
    expect(pills.map((pill) => pill.textContent)).toEqual([
      zh.kanban.colTodo,
      zh.kanban.colInProgress,
      zh.kanban.colDone,
    ]);
    for (const pill of pills) {
      // 状态列只有一个 pill（旧的三按钮组已移除）。
      expect(
        pill.closest("td")?.querySelectorAll('[data-testid="task-status-pill"]'),
      ).toHaveLength(1);
      expect(pill.disabled).toBe(false);
    }
  });

  it("点击 pill 弹出三项状态菜单：当前项禁用并打勾，点击非当前项改状态", async () => {
    updatePersonalTaskAction.mockResolvedValue({ ok: true, data: {} });
    renderPersonal([personalRow({ id: "row-single", title: "任务S" })]);

    openStatusMenu();
    const items = Array.from(
      document.body.querySelectorAll('[data-testid^="task-status-button-"]'),
    );
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.textContent)).toEqual([
      zh.kanban.colTodo,
      zh.kanban.colInProgress,
      zh.kanban.colDone,
    ]);
    const current = document.body.querySelector(
      '[data-testid="task-status-button-todo"]',
    );
    expect(current?.hasAttribute("data-disabled")).toBe(true);
    expect(current?.querySelector("svg")).not.toBeNull();
    const inProgress = document.body.querySelector(
      '[data-testid="task-status-button-in_progress"]',
    );
    expect(inProgress?.hasAttribute("data-disabled")).toBe(false);

    await act(async () => {
      clickStatusItem("in_progress");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updatePersonalTaskAction).toHaveBeenCalledTimes(1);
    expect(updatePersonalTaskAction).toHaveBeenCalledWith("row-single", {
      status: "in_progress",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("团队行状态切换：updateTeamTaskAction 以 { teamId, status } 调用", async () => {
    updateTeamTaskAction.mockResolvedValue({ ok: true, data: {} });
    renderTeam([{ ...rowA, assigneeId: "user-1", assigneeName: "王工" }]);

    openStatusMenu();
    await act(async () => {
      clickStatusItem("in_progress");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateTeamTaskAction).toHaveBeenCalledTimes(1);
    expect(updateTeamTaskAction).toHaveBeenCalledWith(rowA.id, {
      teamId: "team-1",
      status: "in_progress",
    });
  });

  it("不可编辑行 pill 纯展示：disabled（member 改他人任务）", () => {
    renderTeam([{ ...rowA, assigneeId: "user-1", assigneeName: "王工" }], {
      role: "member",
      actorId: "user-2",
    });

    const pill = statusPills()[0];
    expect(pill.textContent).toBe(zh.kanban.colTodo);
    expect(pill.disabled).toBe(true);
  });

  it("状态切换失败：回滚乐观状态并 toast 错误", async () => {
    updatePersonalTaskAction.mockResolvedValue({
      ok: false,
      errors: { form: "没有权限执行该操作" },
    });
    renderPersonal([personalRow({ id: "row-single", title: "任务S" })]);

    openStatusMenu();
    await act(async () => {
      clickStatusItem("in_progress");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastError).toHaveBeenCalled();
    // 回滚成功：pill 回到 todo；若未回滚它会是进行中。
    expect(statusPills()[0].textContent).toBe(zh.kanban.colTodo);
    expect(statusPills()[0].disabled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("变更进行中：全表 pill 一并禁用，pending 行 pill 内显示 spinner", async () => {
    let resolveAction: (value: { ok: true; data: object }) => void = () => {};
    updatePersonalTaskAction.mockReturnValue(
      new Promise<{ ok: true; data: object }>((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderPersonal([
      personalRow({ id: "row-1", title: "任务1" }),
      personalRow({ id: "row-2", title: "任务2" }),
    ]);

    openStatusMenu();
    // action promise 保持未决：pending 不落地，全表 pill 都应禁用。
    await act(async () => {
      clickStatusItem("in_progress");
      await Promise.resolve();
    });

    const pills = statusPills();
    expect(pills).toHaveLength(2);
    expect(pills[0].disabled).toBe(true);
    expect(pills[1].disabled).toBe(true);
    expect(pills[0].querySelector("svg")).not.toBeNull();

    // 收尾释放 promise，避免卸载后仍有状态更新。
    await act(async () => {
      resolveAction({ ok: true, data: {} });
      await Promise.resolve();
    });
  });

  it("本地行过滤：status / priority / projectId 各自收窄，all 不过滤", () => {
    const rows = [
      personalRow({
        id: "f-1",
        title: "过滤A",
        status: "todo",
        priority: "high",
        projectId: "p1",
        dueDate: "2026-11-20",
      }),
      personalRow({
        id: "f-2",
        title: "过滤B",
        status: "todo",
        priority: "low",
        projectId: "p1",
        dueDate: "2026-11-21",
      }),
      personalRow({
        id: "f-3",
        title: "过滤C",
        status: "done",
        priority: "high",
        projectId: "p2",
        dueDate: "2026-11-22",
      }),
    ];

    renderPersonalWithFilters(DEFAULT_LIST_FILTERS, rows);
    expect(bodyRows()).toHaveLength(3);

    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, status: "todo" },
      rows,
    );
    expect(bodyRows()).toHaveLength(2);

    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, priority: "high" },
      rows,
    );
    expect(bodyRows()).toHaveLength(2);

    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, projectId: "p2" },
      rows,
    );
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "过滤C",
    );
  });

  it("本地行过滤：三字段交集组合", () => {
    const rows = [
      personalRow({
        id: "c-1",
        title: "交集命中",
        status: "todo",
        priority: "high",
        projectId: "p1",
        dueDate: "2026-11-20",
      }),
      personalRow({
        id: "c-2",
        title: "优先级不符",
        status: "todo",
        priority: "low",
        projectId: "p1",
        dueDate: "2026-11-21",
      }),
      personalRow({
        id: "c-3",
        title: "项目不符",
        status: "todo",
        priority: "high",
        projectId: "p2",
        dueDate: "2026-11-22",
      }),
      personalRow({
        id: "c-4",
        title: "状态不符",
        status: "in_progress",
        priority: "high",
        projectId: "p1",
        dueDate: "2026-11-23",
      }),
    ];

    renderPersonalWithFilters(
      {
        status: "todo",
        priority: "high",
        projectId: "p1",
      },
      rows,
    );

    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "交集命中",
    );
  });

  it("过滤后无匹配行：渲染空态（复用 kanban.listEmpty*）", () => {
    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, status: "done" },
      [rowA],
    );

    expect(
      document.querySelector('[data-testid="space-task-table"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain(zh.kanban.listEmptyTitle);
  });
});
