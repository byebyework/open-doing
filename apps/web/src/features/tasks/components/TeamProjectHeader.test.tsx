/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectMemberRef } from "@open-doing/types";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { TeamProjectHeader } from "./TeamProjectHeader";

/**
 * jsdom 探针（同 ProjectStatsCard.test.tsx）。
 *
 * 覆盖 Review（2026-11-21）: 编辑弹窗的成员池必须是团队名册（可加未入项目
 * 的成员）；负责人/成员 meta 行展示的是项目当前成员（两者关注点分离）。
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/features/projects/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/projects/actions")>();
  return { ...actual, updateTeamProjectStatusAction: vi.fn() };
});

const roster: ProjectMemberRef[] = [
  { id: "roster-a", name: "甲", image: null },
  { id: "roster-b", name: "乙", image: null },
];
// 项目当前成员：只有甲
const projectMembers: ProjectMemberRef[] = [{ id: "roster-a", name: "甲", image: null }];

describe("TeamProjectHeader", () => {
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

  function render() {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <TeamProjectHeader
            teamId="team-1"
            project={{
              id: "p1",
              name: "项目甲",
              status: "in_progress",
              leadId: "roster-a",
              memberIds: ["roster-a"],
            }}
            projectPath="/space/growth/projects/p1"
            view="list"
            projects={[]}
            members={[]}
            actorId="roster-a"
            canManage
            redirectTo="/space/growth/settings"
            memberPool={roster}
            displayLead={projectMembers[0] ?? null}
            displayMembers={projectMembers}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  function click(selector: string) {
    const button = document.body.querySelector<HTMLButtonElement>(
      selector.includes("[") ? selector : `[data-testid="${selector}"]`,
    );
    if (!button) throw new Error(`missing button ${selector}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("负责人/成员 meta 行展示项目当前成员（非团队名册）", () => {
    render();
    const text = document.body.textContent ?? "";
    // 展示区出现甲（项目成员）
    expect(text).toContain("甲");
    // meta 行不把名册上的乙当作项目成员展示（乙只应出现在编辑弹层里）
    const memberMeta = Array.from(document.body.querySelectorAll("span")).filter((span) =>
      span.textContent?.startsWith("成员"),
    );
    expect(memberMeta.some((span) => span.textContent?.includes("乙"))).toBe(false);
  });

  it("编辑弹窗的成员 pill 选项来自团队名册（可添加未入项目的成员乙）", async () => {
    render();
    click('team-project-edit-trigger');
    // Radix Portal 挂载在下一帧
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    console.log("HAS_PILL", document.body.querySelector('[data-testid="team-project-members-pill"]') !== null);
    console.log("HAS_LEAD", document.body.querySelector('[data-testid="team-project-lead-pill"]') !== null);
    click('[data-testid="team-project-members-pill"]');
    const option = document.body.querySelector('[data-testid="team-project-member-option-roster-b"]');
    expect(option).not.toBeNull();
    expect(option?.textContent).toContain("乙");
  });
});
