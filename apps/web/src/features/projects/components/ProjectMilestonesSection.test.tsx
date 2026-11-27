/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectMilestone } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import {
  addTeamProjectMilestoneAction,
  deleteTeamProjectMilestoneAction,
  updateTeamProjectMilestoneAction,
} from "../actions";
import { ProjectMilestonesSection } from "./ProjectMilestonesSection";

/**
 * jsdom 探针写法（同 ProjectStatsCard.test.tsx）。
 *
 * 覆盖:节点列表渲染（名称/日期/描述）、非管理态无添加入口与删除、
 * 管理态添加卡展开并提交 action、删除确认后 action 被调。
 */
vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    addTeamProjectMilestoneAction: vi.fn(),
    deleteTeamProjectMilestoneAction: vi.fn(),
    updateTeamProjectMilestoneAction: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const mockAdd = vi.mocked(addTeamProjectMilestoneAction);
const mockDelete = vi.mocked(deleteTeamProjectMilestoneAction);
const mockUpdate = vi.mocked(updateTeamProjectMilestoneAction);

const PROJECT_ID = "44444444-4444-4444-4444-444444444444";

function milestone(overrides: Partial<ProjectMilestone> = {}): ProjectMilestone {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    projectId: PROJECT_ID,
    name: "里程碑 A",
    description: "首个交付",
    dueDate: "2026-12-05",
    createdAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProjectMilestonesSection", () => {
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
    vi.resetAllMocks();
  });

  function renderSection(props: {
    milestones: ProjectMilestone[];
    canManage?: boolean;
    progress?: Record<string, { taskCount: number; doneCount: number; percent: number }>;
  }) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectMilestonesSection
            space={{ kind: "team", teamId: "66666666-6666-6666-6666-666666666666" }}
            projectId={PROJECT_ID}
            milestones={props.milestones}
            canManage={props.canManage ?? true}
            progress={props.progress}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function click(testid: string) {
    const button = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="${testid}"]`,
    );
    if (!button) throw new Error(`missing button ${testid}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function setInput(testid: string, value: string) {
    const input = document.body.querySelector<HTMLInputElement>(
      `[data-testid="${testid}"]`,
    );
    if (!input) throw new Error(`missing input ${testid}`);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("渲染节点列表：名称、日期、描述", () => {
    renderSection({
      milestones: [
        milestone(),
        milestone({ id: "66666666-0000-0000-0000-000000000001", name: "上线", description: undefined, dueDate: "2026-12-20" }),
      ],
    });

    expect(document.body.textContent).toContain("里程碑 A");
    expect(document.body.textContent).toContain("首个交付");
    expect(document.body.textContent).toContain("上线");
    expect(document.body.textContent).toContain("2026-12-20");
    // 无节点描述为「-」占位
    expect(document.body.textContent).toContain("-");
  });

  it("带 progress：里程碑行显示 {percent}% of {taskCount}（需求 2 锚点）", () => {
    const ms = milestone();
    renderSection({
      milestones: [ms],
      progress: { [ms.id]: { taskCount: 2, doneCount: 1, percent: 50 } },
    });
    expect(document.body.textContent).toContain("50% of 2");
  });

  it("非管理态：无添加入口、无删除按钮", () => {
    renderSection({ milestones: [milestone()], canManage: false });
    expect(document.body.querySelector('[data-testid="project-milestone-add-trigger"]')).toBeNull();
    expect(document.body.querySelectorAll('[data-testid^="project-milestone-delete-"]').length).toBe(0);
  });

  it("管理态：展开添加卡提交 action 后刷新", async () => {
    mockAdd.mockResolvedValue({ ok: true, data: milestone() });
    renderSection({ milestones: [], canManage: true });

    click("project-milestone-add-trigger");
    setInput("project-milestone-name-input", "评审");
    // 编辑器日期现为 Popover 触发按钮：点击打开后在 popover 内原生输入填值
    click("project-milestone-due-date");
    await act(async () => {});
    const dateInput = document.body.querySelector<HTMLInputElement>(
      '[data-testid="project-milestone-due-date-input"]',
    );
    if (!dateInput) throw new Error("missing date popover input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(dateInput, "2026-12-25");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    click("project-milestone-add-button");
    await act(async () => {});
    await act(async () => {});

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0]).toEqual([
      {
        teamId: "66666666-6666-6666-6666-666666666666",
        projectId: PROJECT_ID,
        name: "评审",
        description: undefined,
        dueDate: "2026-12-25",
      },
    ]);
  });

  it("点击行进入编辑态：预填数据，保存走 update action", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: milestone() });
    renderSection({ milestones: [milestone()] });

    const edit = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="project-milestone-edit-0"]',
    )!;
    act(() => {
      edit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nameInput = document.body.querySelector<HTMLInputElement>(
      '[data-testid="project-milestone-name-input"]',
    )!;
    expect(nameInput.value).toBe("里程碑 A");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(nameInput, "改名");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const save = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="project-milestone-add-button"]',
    )!;
    act(() => {
      save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    await act(async () => {});

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]).toEqual([
      {
        teamId: "66666666-6666-6666-6666-666666666666",
        projectId: PROJECT_ID,
        milestoneId: milestone().id,
        name: "改名",
        description: "首个交付",
        dueDate: "2026-12-05",
      },
    ]);
  });

  it("删除：确认后 action 被调", async () => {
    mockDelete.mockResolvedValue({ ok: true, data: true });
    renderSection({ milestones: [milestone()] });

    click("project-milestone-delete-0");
    click("project-milestone-delete-confirm");

    await act(async () => {});
    await act(async () => {});
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0]).toEqual([
      {
        teamId: "66666666-6666-6666-6666-666666666666",
        projectId: PROJECT_ID,
        milestoneId: milestone().id,
      },
    ]);
  });
});
