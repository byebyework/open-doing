/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tag } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { listTeamProjectMilestonesAction } from "../actions";
import {
  ProjectDetailDrawer,
  type ProjectDrawerProject,
} from "./ProjectDetailDrawer";

/**
 * jsdom 探针写法（同 ProjectStatsCard.test.tsx）。
 *
 * 覆盖:打开时按需拉取里程碑、字段与统计渲染、完整页入口链接、
 * canManage=false 无添加入口、关闭后不渲染。
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    listTeamProjectMilestonesAction: vi.fn(),
  };
});

const mockList = vi.mocked(listTeamProjectMilestonesAction);

function tag(id: string, name: string): Tag {
  return {
    id,
    teamId: "66666666-6666-6666-6666-666666666666",
    ownerId: null,
    name,
    color: "purple",
    type: "project",
    updatedAt: "",
    createdAt: "",
  };
}

const project: ProjectDrawerProject = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "官网改版",
  description: "首页重构与性能优化",
  href: "/space/growth/projects/official",
  priority: "high",
  tags: [tag("t1", "核心目标")],
  statusKind: "in_progress",
  progressPercent: 65,
  milestoneCount: 0,
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  taskCount: 12,
  doneCount: 7,
  overdueCount: 1,
};

describe("ProjectDetailDrawer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockList.mockResolvedValue({ ok: true, data: [] });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  function render(open: boolean, canManage = true) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectDetailDrawer
            open={open}
            onOpenChange={() => {}}
            space={{ kind: "team", teamId: "66666666-6666-6666-6666-666666666666" }}
            project={project}
            canManage={canManage}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("open=false 不渲染内容", () => {
    render(false);
    expect(document.body.querySelector('[data-testid="project-detail-drawer"]')).toBeNull();
  });

  it("打开时拉取里程碑并渲染概览字段、统计与完整页入口", async () => {
    render(true);
    await act(async () => {});
    await act(async () => {});

    expect(mockList).toHaveBeenCalledWith({
      teamId: "66666666-6666-6666-6666-666666666666",
      projectId: "44444444-4444-4444-4444-444444444444",
    });
    const drawer = document.body.querySelector('[data-testid="project-detail-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain("官网改版");
    expect(drawer!.textContent).toContain("首页重构与性能优化");
    expect(drawer!.textContent).toContain("65%");
    expect(drawer!.textContent).toContain("核心目标");
    const link = drawer!.querySelector<HTMLAnchorElement>('[data-testid="project-drawer-full-page-link"]');
    expect(link?.getAttribute("href")).toBe("/space/growth/projects/official");
  });

  it("渲染拉取到的里程碑列表", async () => {
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "55555555-5555-5555-5555-555555555555",
          projectId: "44444444-4444-4444-4444-444444444444",
          name: "评审通过",
          description: "设计评审",
          dueDate: "2026-12-05",
          createdAt: "2026-11-20T00:00:00.000Z",
        },
      ],
    });
    render(true);
    await act(async () => {});
    await act(async () => {});
    expect(document.body.textContent).toContain("评审通过");
    expect(document.body.textContent).toContain("设计评审");
  });

  it("canManage=false 无添加入口", async () => {
    render(true, false);
    await act(async () => {});
    expect(
      document.body.querySelector('[data-testid="project-milestone-add-trigger"]'),
    ).toBeNull();
  });
});
