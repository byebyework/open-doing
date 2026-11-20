/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { createTeamProjectAction, updateTeamProjectAction } from "../actions";
import {
  createPersonalProjectAction,
  updatePersonalProjectAction,
} from "@/features/personal/projects/actions";
import { ProjectForm, type ProjectFormProps } from "./ProjectForm";

/**
 * 沿用 ProjectStatsCard.test.tsx 的 jsdom + act 最小探针写法。
 *
 * 覆盖:优先级 segmented 缺省与切换、里程碑编辑器添加/移除/空名禁用、
 * 编辑态不含里程碑编辑器、团队/个人 action 分派、退出保持窗口幂等闸。
 */
vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return {
    ...actual,
    createTeamProjectAction: vi.fn(),
    updateTeamProjectAction: vi.fn(),
  };
});

vi.mock("@/features/personal/projects/actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/personal/projects/actions")>();
  return {
    ...actual,
    createPersonalProjectAction: vi.fn(),
    updatePersonalProjectAction: vi.fn(),
  };
});

/** Radix Popper 在 layout 阶段无条件 new ResizeObserver（jsdom 未实现）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const mockTeamCreate = vi.mocked(createTeamProjectAction);
const mockTeamUpdate = vi.mocked(updateTeamProjectAction);
const mockPersonalCreate = vi.mocked(createPersonalProjectAction);
const mockPersonalUpdate = vi.mocked(updatePersonalProjectAction);

const TEAM_ID = "11111111-1111-1111-1111-111111111111";

function fakeProjectResult() {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    teamId: TEAM_ID,
    ownerId: null,
    name: "X",
    slug: "x",
    priority: "high" as const,
    createdAt: "2026-11-20T00:00:00.000Z",
  };
}

describe("ProjectForm", () => {
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

  function renderForm(props: Partial<Omit<ProjectFormProps, "onSuccess">> & { onSuccess?: ProjectFormProps["onSuccess"] } = {}) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectForm
            space={{ kind: "team", teamId: TEAM_ID }}
            projectTagPool={[]}
            testIdPrefix="test-project"
            {...props}
            onSuccess={props.onSuccess ?? (() => {})}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function setInput(testid: string, value: string) {
    const input = document.body.querySelector<HTMLInputElement>(
      `[data-testid="${testid}"]`,
    );
    if (!input) throw new Error(`missing input ${testid}`);
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function click(testid: string) {
    const button = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="${testid}"]`,
    );
    if (!button) throw new Error(`missing button ${testid}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function submit() {
    click("test-project-submit-button");
  }

  it("默认优先级「中」；属性行 pill 选「高」后随 payload 提交", async () => {
    mockTeamCreate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm();

    const pill = () =>
      document.body.querySelector<HTMLButtonElement>('[data-testid="test-project-priority-pill"]')!;
    expect(pill().textContent).toContain("中优先级");

    setInput("test-project-name-input", "Prio Project");
    click("test-project-priority-pill");
    click("test-project-priority-option-high");
    submit();
    await act(async () => {});
    await act(async () => {});

    expect(mockTeamCreate).toHaveBeenCalledTimes(1);
    expect(mockTeamCreate.mock.calls[0]![0]).toMatchObject({
      teamId: TEAM_ID,
      name: "Prio Project",
      priority: "high",
    });
  });

  it("日期 pill 缺省显示「未设置」；payload 携带空起止", async () => {
    mockTeamCreate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm();

    expect(
      document.body.querySelector('[data-testid="test-project-start-pill"]')!.textContent,
    ).toContain("未设置");
    expect(
      document.body.querySelector('[data-testid="test-project-end-pill"]')!.textContent,
    ).toContain("未设置");

    setInput("test-project-name-input", "Dates Project");
    submit();
    await act(async () => {});
    await act(async () => {});

    expect(mockTeamCreate.mock.calls[0]![0]).toMatchObject({
      startDate: null,
      endDate: null,
    });
  });

  it("里程碑折叠行：展开编辑器，名称或日期为空时「添加」禁用；添加后随表单一次性提交", async () => {
    mockTeamCreate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm();

    // 折叠态无编辑器；点「添加」展开。
    expect(
      document.body.querySelector('[data-testid="test-project-milestone-add-button"]'),
    ).toBeNull();
    click("test-project-milestone-add-trigger");

    const add = () =>
      document.body.querySelector<HTMLButtonElement>(
        '[data-testid="test-project-milestone-add-button"]',
      )!;
    expect(add().disabled).toBe(true);

    setInput("test-project-name-input", "Milestone Project");
    setInput("test-project-milestone-name-input", "上线");
    expect(add().disabled).toBe(true);

    const dateInput = document.body.querySelector<HTMLInputElement>(
      '[data-testid="test-project-milestone-due-date"] input, input[data-testid="test-project-milestone-due-date"]',
    );
    if (!dateInput) throw new Error("missing milestone date input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(dateInput, "2026-12-20");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(add().disabled).toBe(false);

    click("test-project-milestone-add-button");
    expect(
      document.body.querySelectorAll('[data-testid="test-project-milestone-item"]'),
    ).toHaveLength(1);

    submit();
    await act(async () => {});
    await act(async () => {});

    expect(mockTeamCreate.mock.calls[0]![0]).toMatchObject({
      milestones: [{ name: "上线", dueDate: "2026-12-20" }],
    });
  });

  it("里程碑描述随节点提交；移除后 payload 不携带 milestones", async () => {
    mockTeamCreate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm();

    click("test-project-milestone-add-trigger");
    setInput("test-project-name-input", "Remove Project");
    setInput("test-project-milestone-name-input", "节点");
    setInput("test-project-milestone-description-input", "首个交付");
    const dateInput = document.body.querySelector<HTMLInputElement>(
      '[data-testid="test-project-milestone-due-date"] input, input[data-testid="test-project-milestone-due-date"]',
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(dateInput, "2026-12-05");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click("test-project-milestone-add-button");

    click("test-project-milestone-remove-0");
    expect(
      document.body.querySelectorAll('[data-testid="test-project-milestone-item"]'),
    ).toHaveLength(0);

    submit();
    await act(async () => {});
    await act(async () => {});

    const payload = mockTeamCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.milestones).toBeUndefined();
  });

  it("编辑态：不渲染里程碑编辑器，提交走 update 并带 priority", async () => {
    mockTeamUpdate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm({
      project: {
        id: "33333333-3333-3333-3333-333333333333",
        name: "Old",
        priority: "low",
      },
    });

    expect(
      document.body.querySelector('[data-testid="test-project-milestone-add-button"]'),
    ).toBeNull();

    const low = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="test-project-priority-low"]',
    )!;
    expect(low.getAttribute("aria-pressed")).toBe("true");

    setInput("test-project-name-input", "New");
    submit();
    await act(async () => {});
    await act(async () => {});

    expect(mockTeamUpdate).toHaveBeenCalledTimes(1);
    expect(mockTeamUpdate.mock.calls[0]![0]).toMatchObject({
      teamId: TEAM_ID,
      projectId: "33333333-3333-3333-3333-333333333333",
      priority: "low",
    });
    expect(mockTeamCreate).not.toHaveBeenCalled();
  });

  it("个人空间分派：走 createPersonalProjectAction", async () => {
    mockPersonalCreate.mockResolvedValue({
      ok: true,
      data: { ...fakeProjectResult(), teamId: null, ownerId: "u1" },
    });
    renderForm({ space: { kind: "personal" } });

    setInput("test-project-name-input", "Personal");
    submit();
    await act(async () => {});
    await act(async () => {});

    expect(mockPersonalCreate).toHaveBeenCalledTimes(1);
    expect(mockTeamCreate).not.toHaveBeenCalled();
  });

  it("里程碑列表折叠切换：展开见已加节点，收起只剩行；添加自动展开", async () => {
    mockTeamCreate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm();

    click("test-project-milestone-add-trigger");
    setInput("test-project-name-input", "Toggle Project");
    setInput("test-project-milestone-name-input", "节点一");
    const dateInput = document.body.querySelector<HTMLInputElement>(
      '[data-testid="test-project-milestone-due-date"]',
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(dateInput, "2026-12-01");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click("test-project-milestone-add-button");
    expect(
      document.body.querySelectorAll('[data-testid="test-project-milestone-item"]'),
    ).toHaveLength(1);

    // 收起：列表隐藏，仅剩行；计数徽标保留
    click("test-project-milestone-toggle");
    expect(
      document.body.querySelectorAll('[data-testid="test-project-milestone-item"]'),
    ).toHaveLength(0);
    expect(
      document.body.querySelector('[data-testid="test-project-milestone-toggle"]')!.textContent,
    ).toContain("1");

    // 再展开
    click("test-project-milestone-toggle");
    expect(
      document.body.querySelectorAll('[data-testid="test-project-milestone-item"]'),
    ).toHaveLength(1);
  });

  it("编辑态标签池存在但未选任何标签：payload 带 tagIds: []（清空语义，不静默保留）", async () => {
    mockTeamUpdate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    renderForm({
      project: { id: "33333333-3333-3333-3333-333333333333", name: "NoTags" },
      projectTagPool: [
        { id: "t1", teamId: TEAM_ID, ownerId: null, name: "核心目标", color: "purple", type: "project", updatedAt: "", createdAt: "" },
      ],
    });

    setInput("test-project-name-input", "NoTags");
    submit();
    await act(async () => {});
    await act(async () => {});

    expect(mockTeamUpdate.mock.calls[0]![0]).toMatchObject({ tagIds: [] });
  });

  it("退出保持窗口幂等闸：成功提交后 open=false 再提交不重复调用", async () => {
    mockTeamCreate.mockResolvedValue({ ok: true, data: fakeProjectResult() });
    const onSuccess = vi.fn();

    function rerender(open: boolean) {
      act(() => {
        root.render(
          <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
            <ProjectForm
              space={{ kind: "team", teamId: TEAM_ID }}
              projectTagPool={[]}
              testIdPrefix="test-project"
              open={open}
              onSuccess={onSuccess}
            />
          </NextIntlClientProvider>,
        );
      });
    }

    rerender(true);
    setInput("test-project-name-input", "Gate");
    submit();
    await act(async () => {});
    await act(async () => {});
    expect(mockTeamCreate).toHaveBeenCalledTimes(1);

    // Radix exit-hold：onSuccess 后弹窗关（open=false）但内容仍挂载 ~200ms。
    rerender(false);
    submit();
    await act(async () => {});
    await act(async () => {});
    expect(mockTeamCreate).toHaveBeenCalledTimes(1);
  });
});
