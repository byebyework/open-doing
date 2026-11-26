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

import { NewTaskModal } from "@/features/personal/tasks/components/NewTaskModal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/features/personal/tasks/components/NewTaskModal", () => ({
  NewTaskModal: vi.fn(() => null),
}));

import { PersonalKanbanNewTaskButton } from "./PersonalKanbanNewTaskButton";

/** 标签池必须透传给弹窗——缺省空池会渲染假「还没有标签」空态。 */
describe("PersonalKanbanNewTaskButton 标签池透传", () => {
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

  it("把 tagPool 原样传给 NewTaskModal", () => {
    const pool: Tag[] = [
      {
        id: "t1",
        teamId: null,
        ownerId: "u1",
        name: "调研",
        color: "purple",
        type: "task" as const,
        createdAt: "",
        updatedAt: "",
      },
    ];
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <PersonalKanbanNewTaskButton
            projects={[{ id: "p1", name: "Proj" }]}
            tagPool={pool}
          />
        </NextIntlClientProvider>,
      );
    });

    // React 以 (props, undefined) 调函数组件。
    expect(NewTaskModal).toHaveBeenCalledWith(
      expect.objectContaining({ tagPool: pool }),
      undefined,
    );
  });
});
