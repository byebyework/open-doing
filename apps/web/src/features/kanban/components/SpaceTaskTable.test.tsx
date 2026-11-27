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
  // TaskProjectFilter（TasksViewTabs 右侧）读取路径拼 push URL。
  usePathname: () => "/space/personal/tasks",
  useSearchParams: () => new URLSearchParams(),
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
const { TasksViewTabs } = await import("./TasksViewTabs");
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
      <ListFiltersProvider value={{ filters, setFilter: () => {}, tagOptions: [] }}>
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

  it("个人列表：8 列无操作列，行按排序输出", () => {
    renderPersonal();

    expect(headers()).toEqual([
      zh.tasks.colTask,
      zh.tasks.projectLabel,
      zh.tasks.colMilestone,
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
      zh.tasks.colMilestone,
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

  it("里程碑列：关联显示名称，未关联显示 —", () => {
    const rows = [
      personalRow({ id: "m-1", title: "有里程碑", milestoneName: "上线" }),
      personalRow({ id: "m-2", title: "无里程碑", milestoneName: null }),
    ];
    renderPersonal(rows);

    const heads = headers();
    expect(heads.indexOf(zh.tasks.colMilestone)).toBe(
      heads.indexOf(zh.tasks.projectLabel) + 1,
    );
    const [first, second] = bodyRows();
    expect(first.textContent).toContain("上线");
    expect(second.textContent).toContain("—");
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

  it("状态 pill 单行展示：文本 + chevron 不折行", () => {
    renderPersonalWithFilters(DEFAULT_LIST_FILTERS, [rowA]);

    const pill = document.querySelector('[data-testid="task-status-pill"]');
    expect(pill?.className).toContain("whitespace-nowrap");
  });

  it("本地行过滤：status / priority 各自收窄，all 不过滤（项目过滤已交还服务端）", () => {
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
  });

  it("本地行过滤：status + priority 交集组合", () => {
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
        tag: "all",
      },
      rows,
    );

    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "交集命中",
    );
  });

  it("标签筛选按 tag id 收窄；无标签行在标签筛选下被排除", () => {
    const rows = [
      personalRow({ id: "tg-1", title: "带标签", tags: [tag] }),
      personalRow({ id: "tg-2", title: "无标签", tags: [] }),
    ];

    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, tag: "tag-1" },
      rows,
    );
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "带标签",
    );

    renderPersonalWithFilters({ ...DEFAULT_LIST_FILTERS, tag: "all" }, rows);
    expect(bodyRows()).toHaveLength(2);
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

  it("TasksViewTabs provider 穿透 list slot：点状态筛选后表格只剩匹配行", () => {
    const rows = [
      personalRow({
        id: "i-1",
        title: "待办行",
        status: "todo",
        dueDate: "2026-11-20",
      }),
      personalRow({
        id: "i-2",
        title: "进行行",
        status: "in_progress",
        dueDate: "2026-11-21",
      }),
      personalRow({
        id: "i-3",
        title: "完成行",
        status: "done",
        dueDate: "2026-11-22",
      }),
    ];

    // 模拟页面接线：list slot 以 ReactNode 传入（RSC 创建元素的渲染位置
    // 在 provider 子树内，context 必须能穿透到表格）。
    renderTable(
      <TasksViewTabs
        initialView="list"
        projects={[{ id: "proj-1", name: "官网改版", slug: "site" }]}
        board={<div data-testid="slot-board" />}
        list={
          <SpaceTaskTable
            variant="personal"
            rows={rows}
            today={TODAY}
            taskHrefs={{}}
          />
        }
      />,
    );
    expect(bodyRows()).toHaveLength(3);

    // 项目筛选由 TasksViewTabs 的 TaskProjectFilter 承担（URL 驱动，两视图
    // 常驻）：新触发器在（来自 TaskProjectFilter），旧命名不在（历史残留）。
    expect(
      document.querySelector('[data-testid="task-filter-project"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="list-filter-project"]'),
    ).toBeNull();

    // 打开状态筛选下拉（Radix 由 pointerdown 触发），点「待办」。
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="task-filter-status"]',
    );
    if (!trigger) throw new Error("missing status filter trigger");
    act(() => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });

    const option = document.body.querySelector<HTMLElement>(
      '[data-testid="task-filter-status-option-todo"]',
    );
    if (!option) throw new Error("missing todo filter option");
    act(() => {
      option.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "待办行",
    );
  });

  /** 两行同状态夹具：供「筛选生效时切换状态」的成功 / 失败两条路径共用。 */
  function twoTodoRows(): KanbanCardItem[] {
    return [
      personalRow({
        id: "f-a",
        title: "待办一",
        status: "todo",
        dueDate: "2026-11-20",
      }),
      personalRow({
        id: "f-b",
        title: "待办二",
        status: "todo",
        dueDate: "2026-11-21",
      }),
    ];
  }

  it("状态筛选生效时切换状态：乐观更新把行移出列表，成功后保持移出", async () => {
    let resolveAction: (value: { ok: true; data: object }) => void = () => {};
    updatePersonalTaskAction.mockReturnValue(
      new Promise<{ ok: true; data: object }>((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, status: "todo" },
      twoTodoRows(),
    );
    expect(bodyRows()).toHaveLength(2);

    openStatusMenu(0);
    await act(async () => {
      clickStatusItem("in_progress");
      await Promise.resolve();
    });

    // 乐观状态把第一行变为进行中：status=todo 筛选立即把它移出列表。
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "待办二",
    );
    expect(updatePersonalTaskAction).toHaveBeenCalledWith("f-a", {
      status: "in_progress",
    });

    // action 成功：行保持移出（不会因回滚 / 刷新重新出现在 todo 列表）。
    await act(async () => {
      resolveAction({ ok: true, data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].querySelector("td:first-child")?.textContent).toBe(
      "待办二",
    );
    expect(refresh).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("状态筛选生效时切换状态失败：回滚后行重新进入筛选列表", async () => {
    let resolveAction: (value: {
      ok: false;
      errors: Record<string, string>;
    }) => void = () => {};
    updatePersonalTaskAction.mockReturnValue(
      new Promise<{ ok: false; errors: Record<string, string> }>((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderPersonalWithFilters(
      { ...DEFAULT_LIST_FILTERS, status: "todo" },
      twoTodoRows(),
    );
    expect(bodyRows()).toHaveLength(2);

    openStatusMenu(0);
    await act(async () => {
      clickStatusItem("in_progress");
      await Promise.resolve();
    });

    // pending 期间同样先按乐观状态移出。
    expect(bodyRows()).toHaveLength(1);

    await act(async () => {
      resolveAction({ ok: false, errors: { form: "没有权限执行该操作" } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 回滚把状态改回 todo：行重新进入 status=todo 的筛选列表。
    expect(bodyRows()).toHaveLength(2);
    expect(
      Array.from(document.querySelectorAll("tbody tr td:first-child")).map(
        (td) => td.textContent,
      ),
    ).toEqual(["待办一", "待办二"]);
    expect(toastError).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  /** 12 行夹具：超过默认每页 10 条，足以触发分页行。 */
  function twelveRows(): KanbanCardItem[] {
    return Array.from({ length: 12 }, (_, index) =>
      personalRow({
        id: `page-${index}`,
        title: `分页任务 ${index + 1}`,
        // 升序日期保证排序稳定：第 1 页是前 10 行，第 2 页是后 2 行。
        dueDate: `2026-11-${String(index + 1).padStart(2, "0")}`,
      }),
    );
  }

  function pageInfoText(): string | null | undefined {
    return document.querySelector('[data-testid="task-list-page-info"]')
      ?.textContent;
  }

  function clickPageControl(testid: string): void {
    const control = document.querySelector<HTMLButtonElement>(
      `[data-testid="${testid}"]`,
    );
    if (!control) throw new Error(`missing ${testid}`);
    act(() => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("分页：超过 10 条只渲染第 1 页，下一页切到剩余行", () => {
    renderPersonal(twelveRows());

    expect(bodyRows()).toHaveLength(10);
    expect(pageInfoText()).toBe("第 1 / 2 页 · 共 12 个任务");

    clickPageControl("task-list-page-next");

    expect(bodyRows()).toHaveLength(2);
    expect(pageInfoText()).toBe("第 2 / 2 页 · 共 12 个任务");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="task-list-page-prev"]',
      )?.disabled,
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="task-list-page-next"]',
      )?.disabled,
    ).toBe(true);
  });

  it("分页：10 条以内不渲染分页行", () => {
    renderPersonal([rowA, rowB, rowC, rowD]);

    expect(
      document.querySelector('[data-testid="task-list-page-info"]'),
    ).toBeNull();
    expect(bodyRows()).toHaveLength(4);
  });

  it("分页：URL 初值生效（page / size），越界页码渲染期收敛到末页", () => {
    renderTable(
      <SpaceTaskTable
        variant="personal"
        rows={twelveRows()}
        today={TODAY}
        taskHrefs={{}}
        initialPage={5}
        initialPageSize={20}
      />,
    );

    // size=20：12 条一页装下；page=5 越界，收敛为唯一一页。
    expect(bodyRows()).toHaveLength(12);
    expect(pageInfoText()).toBe("第 1 / 1 页 · 共 12 个任务");
  });

  it("分页：每页条数可在 10 / 20 / 50 间切换", () => {
    renderPersonal(twelveRows());

    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="task-list-page-size"]',
    );
    if (!trigger) throw new Error("missing page size trigger");
    act(() => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });

    const option = document.body.querySelector<HTMLElement>(
      '[data-testid="task-list-page-size-20"]',
    );
    if (!option) throw new Error("missing page size option");
    act(() => {
      option.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(bodyRows()).toHaveLength(12);
    expect(pageInfoText()).toBe("第 1 / 1 页 · 共 12 个任务");
    // 条数超过最小页容量，分页行保留（否则无法切回 10 条/页）。
    expect(
      document.querySelector('[data-testid="task-list-page-size"]')
        ?.textContent,
    ).toContain("每页 20 条");
  });

  it("任务模块来源：行标题链接带 from=tasks&view=list，翻页后带 page", () => {
    const rows = twelveRows();
    renderTable(
      <SpaceTaskTable
        variant="personal"
        rows={rows}
        today={TODAY}
        taskHrefs={Object.fromEntries(
          rows.map((row) => [row.id, `/space/personal/tasks/${row.id}`]),
        )}
        taskOrigin="tasks"
      />,
    );

    const firstHref = bodyRows()[0]
      ?.querySelector("a")
      ?.getAttribute("href");
    expect(firstHref).toContain("?from=tasks&view=list");
    expect(firstHref).not.toContain("page=");

    clickPageControl("task-list-page-next");

    const secondPageHref = bodyRows()[0]
      ?.querySelector("a")
      ?.getAttribute("href");
    expect(secondPageHref).toContain("?from=tasks&view=list&page=2");
  });

  it("非任务模块来源：行标题链接保持原样（返回项目）", () => {
    renderPersonal();

    expect(
      bodyRows()[0]?.querySelector("a")?.getAttribute("href"),
    ).toBe(`/personal/tasks/${rowA.id}`);
  });

  it("项目来源：行标题链接携带非 all 的筛选参数，all 不写", () => {
    const rows = [personalRow({ id: "f-origin", title: "筛选来源" })];
    renderTable(
      <ListFiltersProvider
        value={{
          filters: { status: "todo", priority: "all", tag: "all" },
          setFilter: () => {},
          tagOptions: [],
        }}
      >
        <SpaceTaskTable
          variant="personal"
          rows={rows}
          today={TODAY}
          taskHrefs={{ "f-origin": "/space/personal/tasks/f-origin" }}
          taskOrigin="project"
        />
      </ListFiltersProvider>,
    );

    const href = bodyRows()[0]?.querySelector("a")?.getAttribute("href");
    expect(href).toContain("from=project");
    expect(href).toContain("status=todo");
    expect(href).not.toContain("priority=");
    expect(href).not.toContain("tag=");
  });

  it("分页 / 每页条数写回 URL（replaceState，保留 tab 等其它参数）", () => {
    // 项目详情任务 tab 的切 tab 还原依赖 URL 携带 page / size（focus 1）。
    window.history.replaceState(
      null,
      "",
      "/space/personal/projects/p?tab=tasks&view=list",
    );
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    try {
      const rows = twelveRows();
      renderTable(
        <SpaceTaskTable
          variant="personal"
          rows={rows}
          today={TODAY}
          taskHrefs={Object.fromEntries(
            rows.map((row) => [row.id, `/space/personal/tasks/${row.id}`]),
          )}
          taskOrigin="project"
        />,
      );

      clickPageControl("task-list-page-next");
      let url = replaceSpy.mock.calls.at(-1)?.[2] as URL;
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("tab")).toBe("tasks");
      expect(url.searchParams.get("view")).toBe("list");

      clickPageControl("task-list-page-prev");
      url = replaceSpy.mock.calls.at(-1)?.[2] as URL;
      expect(url.searchParams.get("page")).toBeNull();
      expect(url.searchParams.get("tab")).toBe("tasks");

      // 每页 20 条：size 写入并把页码重置回第 1 页（删 page）。
      const trigger = document.querySelector<HTMLButtonElement>(
        '[data-testid="task-list-page-size"]',
      );
      if (!trigger) throw new Error("missing page size trigger");
      act(() => {
        trigger.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
      });
      const option = document.body.querySelector<HTMLElement>(
        '[data-testid="task-list-page-size-20"]',
      );
      if (!option) throw new Error("missing page size option");
      act(() => {
        option.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      url = replaceSpy.mock.calls.at(-1)?.[2] as URL;
      expect(url.searchParams.get("size")).toBe("20");
      expect(url.searchParams.get("page")).toBeNull();
      expect(url.searchParams.get("tab")).toBe("tasks");
    } finally {
      replaceSpy.mockRestore();
      window.history.replaceState(null, "", "/");
    }
  });
});
