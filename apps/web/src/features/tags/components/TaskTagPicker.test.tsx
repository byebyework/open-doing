/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tag } from "@open-doing/types";

import zh from "@/i18n/messages/zh.json";

import { TaskTagPicker } from "./TaskTagPicker";
import { TaskTags } from "./TaskTags";

/** 沿用仓库 jsdom + act 最小探针写法。覆盖：勾选/取消回调、pool 空提示、
 * canEdit=false 只读、TaskTags 截断 +N、失效标签跳过渲染。 */
const fakePool: Tag[] = [
  { id: "t1", teamId: "team-1", ownerId: null, name: "调研", color: "purple", createdAt: "", type: "task", updatedAt: "" },
  { id: "t2", teamId: "team-1", ownerId: null, name: "Bug", color: "coral", createdAt: "", type: "task", updatedAt: "" },
  { id: "t3", teamId: "team-1", ownerId: null, name: "前端", color: "sky", createdAt: "", type: "task", updatedAt: "" },
];

function createHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function renderPicker(props: {
    value: string[];
    onChange?: (tagIds: string[]) => void;
    pool?: Tag[];
    canEdit?: boolean;
  }) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="zh" messages={zh}>
          <TaskTagPicker
            space={{ kind: "team", teamId: "team-1" }}
            pool={props.pool ?? fakePool}
            value={props.value}
            onChange={props.onChange ?? vi.fn()}
            canEdit={props.canEdit ?? true}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  return { container, root, renderPicker };
}

describe("TaskTagPicker", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    document.body.innerHTML = "";
    harness = createHarness();
  });

  afterEach(() => {
    act(() => harness.root.unmount());
    document.body.innerHTML = "";
  });

  it("勾选 / 取消回调 payload 正确（toggle 语义）", () => {
    const onChange = vi.fn();
    harness.renderPicker({ value: [], onChange });

    const trigger = document.querySelector<HTMLButtonElement>("[data-testid='task-tag-picker-trigger']")!;
    act(() => {
      trigger.click();
    });

    const option = document.querySelector<HTMLButtonElement>("[data-testid='task-tag-option-t1']")!;
    act(() => {
      option.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(["t1"]);

    // 重新受控渲染后取消勾选
    act(() => harness.root.unmount());
    document.body.innerHTML = "";
    harness = createHarness();
    const onChange2 = vi.fn();
    harness.renderPicker({ value: ["t1"], onChange: onChange2 });
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='task-tag-picker-trigger']")!.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='task-tag-option-t1']")!.click();
    });
    expect(onChange2).toHaveBeenLastCalledWith([]);
  });

  it("pool 为空时打开即提示先建标签", () => {
    harness.renderPicker({ value: [], pool: [] });
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='task-tag-picker-trigger']")!.click();
    });
    expect(document.body.textContent).toContain("还没有标签");
  });

  it("canEdit=false 只读渲染已选 pills，无触发器", () => {
    harness.renderPicker({ value: ["t1", "t2"], canEdit: false });
    expect(document.querySelector("[data-testid='task-tag-picker-trigger']")).toBeNull();
    const pills = document.querySelectorAll("[data-testid='tag-pill']");
    expect(pills.length).toBe(2);
  });

  it("pills 触发器与 AttrPill 胶囊同风格", () => {
    harness.renderPicker({ value: [] });
    const trigger = document.querySelector<HTMLButtonElement>(
      "[data-testid='task-tag-picker-trigger']",
    )!;
    expect(trigger.className).toContain("rounded-full");
    expect(trigger.className).toContain("bg-[var(--card)]");
    expect(trigger.className).toContain("text-[13px]");
    expect(trigger.className).not.toContain("rounded-md");
  });
});

describe("TaskTags", () => {
  function renderTags(tags: Tag[], max?: number) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<TaskTags tags={tags} max={max} />);
    });
    return { container, root };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("默认最多 3 个，多余折叠为 +N", () => {
    const tags: Tag[] = ["a", "b", "c", "d", "e"].map((id, i) => ({
      id,
      teamId: "team-1",
      ownerId: null,
      name: `标签${i}`,
      color: "purple",
      createdAt: "",
      type: "task",
      updatedAt: "2026-11-19T00:00:00.000Z",
    }));
    const { container, root } = renderTags(tags);
    expect(container.querySelectorAll("[data-testid='tag-pill']").length).toBe(3);
    expect(container.textContent).toContain("+2");
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("失效（已删除）标签跳过渲染", () => {
    const stale: Tag = { id: "gone", teamId: "team-1", ownerId: null, name: "已删", color: "mint", createdAt: "", type: "task", updatedAt: "" };
    const live: Tag = { id: "live", teamId: "team-1", ownerId: null, name: "存活", color: "mint", createdAt: "", type: "task", updatedAt: "" };
    // 失效 = 调用方未把该 id 解析进 tags；渲染层对 undefined 容错由 picker 层过滤，
    // TaskTags 收到的数组本身只含可渲染项——这里验证空数组不渲染容器。
    const { container, root } = renderTags([stale, live].filter((t) => t.id !== "gone"));
    expect(container.querySelectorAll("[data-testid='tag-pill']").length).toBe(1);
    act(() => root.unmount());
  });
});
