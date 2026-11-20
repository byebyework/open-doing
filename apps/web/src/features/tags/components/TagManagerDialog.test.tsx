/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TagWithUsage } from "@open-doing/types";

import zh from "@/i18n/messages/zh.json";

import { TagManagerButton } from "./TagManagerButton";
import { TagManagerDialog } from "./TagManagerDialog";

/**
 * 沿用仓库 jsdom + act 最小探针写法；actions 与 router 全部 mock。
 * 覆盖：initialTags 渲染、新建成功后 refresh、field 错误回显、
 * canManage=false 无入口。
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshSpy, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    createTagAction: vi.fn(),
    updateTagAction: vi.fn(),
    deleteTagAction: vi.fn(),
  };
});

import { createTagAction, deleteTagAction } from "../actions";

const refreshSpy = vi.fn();
const mockCreate = vi.mocked(createTagAction);
const mockDelete = vi.mocked(deleteTagAction);

const SPACE = { kind: "team", teamId: "team-1" } as const;

/** React 的受控 input 需要绕过 value tracker：用原型 setter 赋值后派发 input。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: Element | null): void {
  act(() => {
    (element as HTMLElement | null)?.click();
  });
}

const fakeTags: TagWithUsage[] = [
  {
    id: "tag-1",
    teamId: "team-1",
    ownerId: null,
    name: "调研",
    color: "purple",
    createdAt: "2026-11-19T00:00:00.000Z",
    type: "task",
    updatedAt: "2026-11-19T00:00:00.000Z",
    usageCount: 2,
  },
  {
    id: "tag-2",
    teamId: "team-1",
    ownerId: null,
    name: "Bug",
    color: "coral",
    createdAt: "2026-11-19T01:00:00.000Z",
    type: "task",
    updatedAt: "2026-11-19T00:00:00.000Z",
    usageCount: 0,
  },
];

function createHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function render(props: Parameters<typeof TagManagerDialog>[0]) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="zh" messages={zh}>
          <TagManagerDialog {...props} />
        </NextIntlClientProvider>,
      );
    });
  }

  return { container, root, render };
}

describe("TagManagerDialog", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    harness = createHarness();
  });

  afterEach(() => {
    act(() => harness.root.unmount());
    document.body.innerHTML = "";
  });

  it("open 时渲染标签列表（名称 + 使用计数）", () => {
    harness.render({ open: true, onOpenChange: vi.fn(), space: SPACE, initialTags: fakeTags, canManage: true });

    expect(document.querySelector("[data-testid='tag-manager']")).not.toBeNull();
    expect(document.body.textContent).toContain("调研");
    expect(document.body.textContent).toContain("Bug");
    expect(document.body.textContent).toContain("2");
  });

  it("closed 时不渲染面板", () => {
    harness.render({ open: false, onOpenChange: vi.fn(), space: SPACE, initialTags: fakeTags, canManage: true });
    expect(document.querySelector("[data-testid='tag-manager']")).toBeNull();
  });

  it("新建成功：调用 createTagAction 并 router.refresh", async () => {
    mockCreate.mockResolvedValue({ ok: true, data: fakeTags[0] });

    harness.render({ open: true, onOpenChange: vi.fn(), space: SPACE, initialTags: [], canManage: true });

    // 创建区默认收起：先点「新建标签」展开编辑行（空池则自动展开）。
    const toggle = document.querySelector<HTMLButtonElement>("[data-testid='tag-new-toggle']")!;
    click(toggle);

    const input = document.querySelector<HTMLInputElement>("[data-testid='tag-name-input']")!;
    setInputValue(input, "新标签");

    const submit = document.querySelector<HTMLButtonElement>("[data-testid='tag-save-name-input']")!;
    await act(async () => {
      submit.click();
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("空池自动展开创建编辑行", () => {
    harness.render({ open: true, onOpenChange: vi.fn(), space: SPACE, initialTags: [], canManage: true });
    expect(document.querySelector("[data-testid='tag-name-input']")).not.toBeNull();
  });

  it("新建失败（field 错误）：错误文案回显且不 refresh", async () => {
    mockCreate.mockResolvedValue({ ok: false, errors: { name: "同名标签已存在" } });

    harness.render({ open: true, onOpenChange: vi.fn(), space: SPACE, initialTags: [], canManage: true });

    click(document.querySelector<HTMLButtonElement>("[data-testid='tag-new-toggle']")!);
    const input = document.querySelector<HTMLInputElement>("[data-testid='tag-name-input']")!;
    setInputValue(input, "重复");
    const submit = document.querySelector<HTMLButtonElement>("[data-testid='tag-save-name-input']")!;
    await act(async () => {
      submit.click();
    });

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='tag-error-name-input']")).not.toBeNull();
  });

  it("删除走确认弹窗，成功后 refresh", async () => {
    mockDelete.mockResolvedValue({ ok: true, data: true });

    harness.render({ open: true, onOpenChange: vi.fn(), space: SPACE, initialTags: fakeTags, canManage: true });

    const menu = document.querySelector<HTMLButtonElement>("[data-testid='tag-menu-tag-1']")!;
    await act(async () => {
      // Radix DropdownMenu 以 pointerdown 开启（click 不触发）。
      menu.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
    });
    await act(async () => {});

    const remove = document.querySelector<HTMLButtonElement>("[data-testid='tag-delete-tag-1']")!;
    await act(async () => {
      remove.click();
    });

    const confirm = document.querySelector<HTMLButtonElement>("[data-testid='tag-delete-confirm']")!;
    await act(async () => {
      confirm.click();
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalled();
  });
});

describe("TagManagerButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("canManage=false 不渲染入口", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <NextIntlClientProvider locale="zh" messages={zh}>
          <TagManagerButton space={SPACE} initialTags={fakeTags} canManage={false} />
        </NextIntlClientProvider>,
      );
    });
    expect(container.querySelector("[data-testid='tags-manage-button']")).toBeNull();
    act(() => root.unmount());
  });

  it("canManage=true 渲染入口，点击打开弹层", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <NextIntlClientProvider locale="zh" messages={zh}>
          <TagManagerButton space={SPACE} initialTags={fakeTags} canManage />
        </NextIntlClientProvider>,
      );
    });
    const button = container.querySelector("[data-testid='tags-manage-button']");
    expect(button).not.toBeNull();
    act(() => {
      (button as HTMLButtonElement).click();
    });
    expect(document.querySelector("[data-testid='tag-manager']")).not.toBeNull();
    act(() => root.unmount());
  });
});
