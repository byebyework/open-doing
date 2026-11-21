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

import { updateTeamProjectAction } from "../actions";
import { ProjectOverviewPanel } from "./ProjectOverviewPanel";

/** jsdom 探针：概览主列结构、内联编辑 action 调用、里程碑行进度、个人空间无 lead/members。 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return { ...actual, updateTeamProjectAction: vi.fn() };
});

const mockUpdate = vi.mocked(updateTeamProjectAction);

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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  function render(project: Project, space: "team" | "personal" = "team") {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectOverviewPanel
            project={project}
            milestones={[
              {
                milestone: {
                  id: "m1",
                  projectId: project.id,
                  name: "上线",
                  dueDate: "2026-12-20",
                  createdAt: "2026-11-20T00:00:00.000Z",
                },
                taskCount: 3,
                doneCount: 2,
                percent: 67,
              },
            ]}
            memberPool={
              space === "team"
                ? [
                    { id: "u1", name: "甲", image: null },
                    { id: "u2", name: "乙", image: null },
                  ]
                : []
            }
            displayLead={space === "team" ? { id: "u1", name: "甲", image: null } : null}
            displayMembers={space === "team" ? [{ id: "u1", name: "甲", image: null }] : []}
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

  it("渲染标题/简述/里程碑进度行；团队空间展示负责人", () => {
    render(projectFixture());
    expect(document.body.textContent).toContain("官网改版");
    expect(document.body.textContent).toContain("首页重构");
    expect(document.body.textContent).toContain("上线");
    expect(document.body.textContent).toContain("3 任务 · 67%");
    expect(document.body.textContent).toContain("甲");
  });

  it("个人空间不渲染负责人", () => {
    render(projectFixture(), "personal");
    expect(document.body.textContent).not.toContain("甲");
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
