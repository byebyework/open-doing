/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { listPersonalProjectMilestonesAction } from "@/features/personal/projects/actions";

vi.mock("@/features/personal/projects/actions", () => ({
  listPersonalProjectMilestonesAction: vi.fn(),
}));
vi.mock("../actions", () => ({
  createPersonalTaskAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { NewTaskModal } from "./NewTaskModal";

/** 空标签池时标签选择区仍渲染（入口常显，空态由选择器承担）。 */
describe("NewTaskModal（个人）空标签池", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(listPersonalProjectMilestonesAction).mockResolvedValue({
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
          <NewTaskModal
            open
            projects={[{ id: "p1", name: "Proj" }]}
            defaultProjectId="p1"
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
