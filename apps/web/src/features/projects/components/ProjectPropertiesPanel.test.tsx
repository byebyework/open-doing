/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { updateTeamProjectAction } from "../actions";
import { ProjectPropertiesPanel } from "./ProjectPropertiesPanel";

/** 成员行可编辑：Popover 勾选名册成员 → memberIds 全量覆写且保留 lead。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return { ...actual, updateTeamProjectAction: vi.fn() };
});

const mockUpdate = vi.mocked(updateTeamProjectAction);

const project: Project = {
  id: "p1",
  teamId: "team-1",
  ownerId: null,
  name: "项目甲",
  slug: "p1",
  status: "backlog",
  priority: "medium",
  leadId: "u1",
  members: [{ id: "u1", name: "甲", image: null }],
  createdAt: "2026-11-20T00:00:00.000Z",
};

const roster = [
  { id: "u1", name: "甲", image: null },
  { id: "u2", name: "乙", image: null },
];

describe("ProjectPropertiesPanel 成员行", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockUpdate.mockResolvedValue({ ok: true, data: project });
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

  it("移除作为负责人的成员：leadId 同步清空", async () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectPropertiesPanel
            project={project}
            memberPool={roster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    click('[data-testid="properties-members-pill"]');
    // 取消勾选 u1（他是负责人）
    click('[data-testid="properties-member-option-u1"]');
    click('[data-testid="properties-members-pill"]');

    await act(async () => {});
    await act(async () => {});

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        memberIds: [],
        leadId: null,
      }),
    );
  });

  it("负责人 pill 选「未设置」：leadId 清空且成员移除旧负责人", async () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectPropertiesPanel
            project={project}
            memberPool={roster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    click('[data-testid="properties-lead-pill"]');
    click('[data-testid="properties-lead-clear"]');

    await act(async () => {});
    await act(async () => {});

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: null,
        memberIds: [],
      }),
    );
  });

  it("成员行按 project.members 渲染头像栈；负责人行展示头像加名称", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectPropertiesPanel
            project={project}
            memberPool={roster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    // 成员行：成员头像而非「未设置」占位（回归：详情页曾因 project.members
    // 未装载而在保存刷新后永远回显未设置）
    const membersPill = document.body.querySelector('[data-testid="properties-members-pill"]');
    expect(membersPill?.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(membersPill?.textContent).not.toContain(zh.projects.notSet);

    // 负责人行：头像 + 名称，与成员行可区分
    const leadPill = document.body.querySelector('[data-testid="properties-lead-pill"]');
    expect(leadPill?.querySelector('[role="img"]')).not.toBeNull();
    expect(leadPill?.textContent).toContain("甲");
  });

  it("成员很多时头像栈封顶 4 个并显示 +N（悬停可见全名单）", () => {
    const manyRoster = [
      { id: "u1", name: "甲", image: null },
      { id: "u2", name: "乙", image: null },
      { id: "u3", name: "丙", image: null },
      { id: "u4", name: "丁", image: null },
      { id: "u5", name: "戊", image: null },
      { id: "u6", name: "己", image: null },
      { id: "u7", name: "庚", image: null },
    ];
    const manyProject: Project = {
      ...project,
      leadId: "u1",
      members: manyRoster,
    };

    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectPropertiesPanel
            project={manyProject}
            memberPool={manyRoster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    const membersPill = document.body.querySelector('[data-testid="properties-members-pill"]');
    expect(membersPill?.querySelectorAll('[role="img"]')).toHaveLength(4);
    expect(membersPill?.textContent).toContain("+3");
    // 溢出圆点悬停提示携带完整名单
    const overflow = Array.from(membersPill?.querySelectorAll("[title]") ?? []).find((el) =>
      el.textContent?.includes("+3"),
    );
    expect(overflow?.getAttribute("title")).toContain("庚");
  });

  it("收起属性卡：体内容驻留至退出动画结束（不是瞬时卸载）", async () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectPropertiesPanel
            project={project}
            memberPool={roster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    // 展开态：内容在 DOM
    expect(document.body.querySelector('[data-testid="properties-lead-pill"]')).not.toBeNull();

    click('[data-testid="properties-collapse"]');

    // 点击后立即查询：退出动画进行中，内容应仍驻留（AnimatePresence exit）
    expect(document.body.querySelector('[data-testid="properties-lead-pill"]')).not.toBeNull();

    // 动画结束后卸载
    await vi.waitFor(
      () => {
        expect(document.body.querySelector('[data-testid="properties-lead-pill"]')).toBeNull();
      },
      { timeout: 2_000 },
    );
  });

  it("成员 Popover 勾选名册成员后保存：memberIds 含 lead 自动并入", async () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectPropertiesPanel
            project={project}
            memberPool={roster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    click('[data-testid="properties-members-pill"]');
    click('[data-testid="properties-member-option-u2"]');
    click('[data-testid="properties-members-pill"]'); // 收起并触发保存

    await act(async () => {});
    await act(async () => {});

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        memberIds: expect.arrayContaining(["u1", "u2"]),
        leadId: "u1",
      }),
    );
  });

  it("属性行 label 用 12px meta 档", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="zh" messages={zh}>
          <ProjectPropertiesPanel
            project={project}
            memberPool={roster}
            canManage
            space={{ kind: "team", teamId: "team-1" }}
          />
        </NextIntlClientProvider>,
      );
    });

    // testid 在状态 pill 上；行容器靠 .justify-between 上溯，行内首个 span 即 label。
    const pill = document.querySelector(
      '[data-testid="properties-status-pill"]',
    )!;
    const rowEl = pill.closest(".justify-between")!;
    const label = rowEl.querySelector(":scope > span")!;
    expect(label.className).toContain("text-[12px]");
    expect(label.className).not.toContain("text-[12.5px]");
  });
});
