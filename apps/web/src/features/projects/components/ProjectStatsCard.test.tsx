/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { PROJECT_CARD_TEST_ID, ProjectStatsCard } from "./ProjectStatsCard";

/**
 * 仓库 vitest 是 node 环境(无 @testing-library),沿用 ConfirmModal.test.tsx
 * 的 jsdom + React 官方 act 最小探针写法,NextIntlClientProvider 挂真实 zh 文案。
 *
 * 覆盖:健康徽标四态渲染、逾期计数为 0 时不渲染逾期文案、href 落在卡片链接、
 * 描述缺省时不渲染描述节点。
 */
function createHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function renderCard(props: {
    health?: "overdue" | "dueSoon" | "notStarted" | "normal";
    overdueCount?: number;
    description?: string;
    href?: string;
  }) {
    act(() => {
      root.render(
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <ProjectStatsCard
          name="官网改版"
          description={props.description}
          href={props.href ?? "/space/growth/projects/site"}
          stats={{
            progress: 0.62,
            taskCount: 18,
            doneCount: 11,
            overdueCount: props.overdueCount ?? 0,
            dueSoonCount: 0,
          }}
          health={props.health ?? "normal"}
        />
        </NextIntlClientProvider>,
      );
    });
  }

  return {
    container,
    renderCard,
    cleanup() {
      root.unmount();
      container.remove();
    },
  };
}

describe("ProjectStatsCard", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.cleanup();
  });

  it("渲染名称、进度百分比、任务数与已完成数,href 落在卡片链接上", () => {
    harness.renderCard({});

    const card = document.querySelector(`[data-testid="${PROJECT_CARD_TEST_ID}"]`);
    expect(card).not.toBeNull();
    expect(card?.getAttribute("href")).toBe("/space/growth/projects/site");
    expect(card?.textContent).toContain("官网改版");
    expect(card?.textContent).toContain("62%");
    expect(card?.textContent).toContain("18 个任务");
    expect(card?.textContent).toContain("11 已完成");
  });

  it("四态健康徽标渲染对应文案", () => {
    harness.renderCard({ health: "overdue" });
    expect(document.body.textContent).toContain("已逾期");

    harness.cleanup();
    harness = createHarness();
    harness.renderCard({ health: "dueSoon" });
    expect(document.body.textContent).toContain("临期");

    harness.cleanup();
    harness = createHarness();
    harness.renderCard({ health: "notStarted" });
    expect(document.body.textContent).toContain("未开始");

    harness.cleanup();
    harness = createHarness();
    harness.renderCard({ health: "normal" });
    expect(document.body.textContent).toContain("正常");
  });

  it("overdueCount 为 0 时不渲染逾期文案", () => {
    harness.renderCard({ health: "normal", overdueCount: 0 });
    expect(document.body.textContent).not.toContain("逾期");
  });

  it("overdueCount > 0 时渲染逾期计数", () => {
    harness.renderCard({ health: "overdue", overdueCount: 2 });
    expect(document.body.textContent).toContain("逾期 2");
  });

  it("描述缺省时不渲染描述节点", () => {
    harness.renderCard({});
    const card = document.querySelector(`[data-testid="${PROJECT_CARD_TEST_ID}"]`);
    // 名称在卡片内,但没有描述 <p> 节点。
    expect(card?.querySelector("p")).toBeNull();
  });
});
