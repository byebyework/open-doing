/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { deleteTeamProjectAction, updateTeamProjectStatusAction } from "../actions";
import { ProjectListTable, type ProjectListRow } from "./ProjectListTable";

/** 回归：列表删除曾因 ConfirmModal 未渲染而整体失效（点击无任何反馈）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    deleteTeamProjectAction: vi.fn(),
    updateTeamProjectStatusAction: vi.fn(),
  };
});

const mockDelete = vi.mocked(deleteTeamProjectAction);

const row: ProjectListRow = {
  id: "p1",
  name: "项目甲",
  href: "/space/team-1/projects/p1",
  priority: "medium",
  tags: [],
  status: "backlog",
  lead: null,
  members: [],
  progressPercent: 0,
  milestoneCount: 0,
  taskCount: 2,
  doneCount: 1,
  overdueCount: 0,
};

describe("ProjectListTable 删除", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockDelete.mockResolvedValue({ ok: true, data: { id: "p1" } as never });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  function click(selector: string) {
    const button = document.body.querySelector<HTMLElement>(selector);
    if (!button) throw new Error(`missing ${selector}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("行内删除：确认弹层出现且确认后调用删除 action", async () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectListTable
            rows={[row]}
            space={{ kind: "team", teamId: "team-1" }}
            canManage
          />
        </NextIntlClientProvider>,
      );
    });

    click('[data-testid="project-row-delete-0"]');

    // 确认弹层出现（此前缺失：点击后无任何反馈，删除整体失效）
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(zh.projects.deleteProject);

    // 确认按钮（危险操作）→ 调 action
    const confirm = Array.from(dialog!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(zh.common.delete),
    );
    expect(confirm).toBeDefined();
    clickOn(confirm!);

    await act(async () => {});
    await act(async () => {});

    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", projectId: "p1" }),
    );
  });

  function clickOn(button: HTMLElement) {
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
});
