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
});
