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

    // 胶囊行内 TaskTagPicker 自带触发器（独立 Label 已随结构移植移除）。
    const trigger = document.querySelector<HTMLButtonElement>(
      "[data-testid='task-tag-picker-trigger']",
    );
    expect(trigger, "tag picker hidden with empty pool").not.toBeNull();
    act(() => {
      trigger!.click();
    });
    expect(document.body.textContent).toContain(zh.tags.emptyPool);
  });

  it("空里程碑选项：里程碑下拉仍渲染，展开只有「无里程碑」", () => {
    render();

    const select = document.querySelector('[data-testid="task-milestone-select"]');
    expect(select, "milestone select hidden with empty options").not.toBeNull();

    act(() => {
      select!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const items = document.body.querySelectorAll(
      '[data-testid^="task-milestone-option-"]',
    );
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain(zh.tasks.milestoneNone);
  });

  it("结构对齐项目弹窗：900px 壳、内联大标题、属性胶囊行、footer 右对齐", () => {
    render();

    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.className).toContain("sm:max-w-[900px]");

    const title = document.body.querySelector<HTMLInputElement>(
      '[data-testid="task-title-input"]',
    )!;
    expect(title.className).toContain("text-[22px]");
    expect(title.closest("label")).toBeNull();

    for (const id of [
      "task-project-select",
      "task-priority-select",
      "task-milestone-select",
      "task-tag-picker-trigger",
      "task-start-date-input",
      "task-due-date-input",
    ]) {
      expect(document.body.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }

    const submit = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="task-create-submit-button"]',
    )!;
    const footer = submit.closest("div")!;
    expect(footer.className).toContain("justify-end");
    expect(footer.className).toContain("mt-4");
  });
});

