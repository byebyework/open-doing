/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { updateTeamProjectAction, updateTeamProjectMilestoneAction } from "../actions";
import { ProjectOverviewPanel } from "./ProjectOverviewPanel";

/** jsdom 探针：概览主列结构、内联编辑 action 调用、里程碑行进度、个人空间无 lead/members。 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    updateTeamProjectAction: vi.fn(),
    updateTeamProjectMilestoneAction: vi.fn(),
  };
});

const mockUpdate = vi.mocked(updateTeamProjectAction);
const mockUpdateMilestone = vi.mocked(updateTeamProjectMilestoneAction);

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    teamId: "team-1",
    ownerId: null,
    name: "官网改版",
    slug: "official",
    status: "in_progress",
    leadId: null,
    summary: "首页重构",
    description: "",
    priority: "high",
    createdAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProjectOverviewPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockUpdate.mockResolvedValue({ ok: true, data: projectFixture() });
    mockUpdateMilestone.mockResolvedValue({
      ok: true,
      data: {
        id: "m1",
        projectId: "p1",
        name: "上线",
        dueDate: "2026-12-20",
        createdAt: "2026-11-20T00:00:00.000Z",
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  function render(
    project: Project,
    space: "team" | "personal" = "team",
    projectTagPool: Project["tags"] = [],
    milestoneOverrides: { description?: string } = {},
  ) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectOverviewPanel
            project={project}
            projectTagPool={projectTagPool}
            milestones={[
              {
                milestone: {
                  id: "m1",
                  projectId: project.id,
                  name: "上线",
                  dueDate: "2026-12-20",
                  createdAt: "2026-11-20T00:00:00.000Z",
                  ...milestoneOverrides,
                },
                taskCount: 3,
                doneCount: 2,
                percent: 67,
              },
            ]}
            displayLead={space === "team" ? { id: "u1", name: "甲", image: null } : null}
            canManage
            space={space === "team" ? { kind: "team", teamId: "team-1" } : { kind: "personal" }}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function click(selector: string) {
    const button = document.body.querySelector<HTMLElement>(selector);
    if (!button) throw new Error(`missing ${selector}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function setInput(selector: string, value: string) {
    const input = document.body.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`missing input ${selector}`);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function setTextarea(selector: string, value: string) {
    const area = document.body.querySelector<HTMLTextAreaElement>(selector);
    if (!area) throw new Error(`missing textarea ${selector}`);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(area, value);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("展开里程碑描述未修改时失焦不覆盖原描述", async () => {
    render(projectFixture(), "team", [], { description: "原有描述" });
    click('[data-testid="overview-milestone-toggle-m1"]');
    const area = document.body.querySelector<HTMLTextAreaElement>(
      '[data-testid="overview-milestone-description-m1"]',
    )!;
    expect(area.value).toBe("原有描述");

    act(() => {
      area.focus();
      area.blur();
    });
    await act(async () => {});

    expect(mockUpdateMilestone).not.toHaveBeenCalled();
  });

  it("展开里程碑描述修改后失焦保存", async () => {
    render(projectFixture(), "team", [], { description: "原有描述" });
    click('[data-testid="overview-milestone-toggle-m1"]');
    setTextarea('[data-testid="overview-milestone-description-m1"]', "更新后的描述");
    const area = document.body.querySelector<HTMLTextAreaElement>(
      '[data-testid="overview-milestone-description-m1"]',
    )!;

    act(() => {
      area.focus();
      area.blur();
    });
    await act(async () => {});

    expect(mockUpdateMilestone).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        projectId: "p1",
        milestoneId: "m1",
        description: "更新后的描述",
      }),
    );
  });

  it("渲染标题/简述/里程碑进度行；团队空间展示负责人", () => {
    render(projectFixture());
    expect(document.body.textContent).toContain("官网改版");
    expect(document.body.textContent).toContain("首页重构");
    expect(document.body.textContent).toContain("上线");
    expect(document.body.textContent).toContain("3 任务 · 67%");
    expect(document.body.textContent).toContain("甲");
  });

  it("属性行只展示负责人头像，不展示成员头像栈", () => {
    render(projectFixture());
    const avatars = document.body.querySelectorAll('[role="img"]');
    expect(avatars).toHaveLength(1);
    expect(avatars[0]?.getAttribute("aria-label")).toBe("甲");
  });

  it("个人空间不渲染负责人", () => {
    render(projectFixture(), "personal");
    expect(document.body.textContent).not.toContain("甲");
  });

  it("标签行：+ 钮弹出勾选列表，勾选后保存 tagIds", async () => {
    render(
      projectFixture({
        tags: [
          { id: "t1", teamId: "team-1", ownerId: null, name: "P1", color: "purple", type: "project", updatedAt: "", createdAt: "" },
        ],
      }),
      "team",
      [
        { id: "t1", teamId: "team-1", ownerId: null, name: "P1", color: "purple", type: "project", updatedAt: "", createdAt: "" },
        { id: "t2", teamId: "team-1", ownerId: null, name: "P2", color: "mint", type: "project", updatedAt: "", createdAt: "" },
      ],
    );
    expect(document.body.querySelector('[data-testid="overview-labels-add"]')).not.toBeNull();

    click('[data-testid="overview-labels-add"]');
    click('[data-testid="overview-labels-option-t2"]');
    // 勾选即保存（逐次持久化），无需关闭
    await act(async () => {});
    await act(async () => {});

    await act(async () => {});
    await act(async () => {});
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tagIds: expect.arrayContaining(["t1", "t2"]),
      }),
    );
  });

  it("简述内联编辑：保存走单字段 update action", async () => {
    render(projectFixture());
    click('[data-testid="project-summary-display"]');
    setInput('[data-testid="project-summary-edit"]', "新简述");
    click('[aria-label="保存"]');
    await act(async () => {});
    await act(async () => {});
    expect(mockUpdate).toHaveBeenCalledWith({
      teamId: "team-1",
      projectId: "p1",
      summary: "新简述",
    });
  });

  it("标题内联改名：回填当前名，保存走 name 字段（回归：重构后无改名入口）", async () => {
    render(projectFixture());
    click('[data-testid="project-name-display"]');
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="project-name-edit"]');
    expect(input?.value).toBe("官网改版");
    setInput('[data-testid="project-name-edit"]', "官网改版 2.0");
    click('[aria-label="保存"]');
    await act(async () => {});
    await act(async () => {});
    expect(mockUpdate).toHaveBeenCalledWith({
      teamId: "team-1",
      projectId: "p1",
      name: "官网改版 2.0",
    });
  });

  it("简述为空时展示回退描述；编辑回填所见文案（summary/description 同源）", () => {
    render(projectFixture({ summary: undefined, description: "持续学习与个人知识管理。" }));
    // 展示行回退显示描述文案
    expect(document.body.querySelector('[data-testid="project-summary-display"]')?.textContent).toContain(
      "持续学习与个人知识管理。",
    );
    click('[data-testid="project-summary-display"]');
    // 编辑器回填展示文案（回归：曾只回填 project.summary，简述为空时编辑器清空）
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="project-summary-edit"]');
    expect(input?.value).toBe("持续学习与个人知识管理。");
  });

  it("描述空态展示提示语，内联编辑走 description 字段", async () => {
    render(projectFixture({ description: undefined }));
    const display = document.body.querySelector('[data-testid="project-description-display"]')!;
    expect(display.textContent).toContain("写下项目描述");
    click('[data-testid="project-description-display"]');
    const area = document.body.querySelector<HTMLTextAreaElement>(
      '[data-testid="project-description-edit"]',
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(area, "详细描述内容");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click('[data-testid="project-description-edit"]');
    const save = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("保存"),
    )!;
    act(() => {
      save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    await act(async () => {});
    expect(mockUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: "详细描述内容" }),
    );
  });
});
