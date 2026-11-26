/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { listTeamProjectMilestonesAction } from "@/features/projects/actions";

vi.mock("@/features/projects/actions", () => ({
  listTeamProjectMilestonesAction: vi.fn(),
}));
vi.mock("../actions", () => ({
  createTeamTaskAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { NewTeamTaskModal } from "./NewTeamTaskModal";

/** 空标签池时标签选择区仍渲染（入口常显，空态由选择器承担）。 */
describe("NewTeamTaskModal 空标签池", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(listTeamProjectMilestonesAction).mockResolvedValue({
      ok: true,
      data: [],
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  function render() {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <NewTeamTaskModal
            open
            teamId="team-1"
            projects={[{ id: "p1", name: "Proj" }]}
            defaultProjectId="p1"
            members={[{ id: "u1", name: "A" }]}
            defaultAssigneeId="u1"
            onSuccess={() => {}}
            onCancel={() => {}}
            tagPool={[]}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("空标签池：标签选择区仍渲染，打开显示空态文案", () => {
    render();

    expect(document.body.textContent).toContain(zh.tags.tagNameLabel);

    const trigger = document.querySelector<HTMLButtonElement>(
      "[data-testid='task-tag-picker-trigger']",
    );
    expect(trigger, "tag picker hidden with empty pool").not.toBeNull();
    act(() => {
      trigger!.click();
    });
    expect(document.body.textContent).toContain(zh.tags.emptyPool);
  });
});
