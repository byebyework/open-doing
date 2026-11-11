/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) =>
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href={props.href}>{props.children}</a>,
}));

const { ProjectTaskTable } = await import("./ProjectTaskTable");
import type { ProjectTask } from "./TaskRowActions";

const task: ProjectTask = {
  id: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  spaceType: "personal",
  title: "写周报",
  status: "todo",
  priority: "high",
  assigneeId: "33333333-3333-3333-3333-333333333333",
  dueDate: "2026-10-30",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  subtasks: [],
};

describe("ProjectTaskTable（操作列 / 优先级列结构）", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
  });

  function renderTable() {
    act(() => {
      root?.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectTaskTable
            tasks={[task]}
            today="2026-10-21"
            projectId={task.projectId!}
            projects={[{ id: task.projectId!, name: "阅读" }]}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  it("渲染优先级列 chip（dot + 文字）", () => {
    renderTable();

    const chip = document.querySelector('[data-testid="priority-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-priority")).toBe("high");
  });

  it("表头含「操作」列", () => {
    renderTable();

    const headers = Array.from(document.querySelectorAll("th")).map(
      (th) => th.textContent,
    );
    expect(headers).toContain(zh.tasks.opsColumn);
  });

  it("不再渲染行尾「⋯」下拉触发器（任务列单元格内无按钮）", () => {
    renderTable();

    const titleCellButton = document.querySelector(
      "tbody tr td:first-child button",
    );
    expect(titleCellButton).toBeNull();
  });

  it("操作列含编辑入口（aria 指向编辑任务）", () => {
    renderTable();

    const edit = document.querySelector(
      `[aria-label="${zh.tasks.editTaskAria.replace("{title}", task.title)}"]`,
    );
    expect(edit).not.toBeNull();
  });
});
