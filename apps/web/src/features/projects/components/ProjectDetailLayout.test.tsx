/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { ProjectDetailLayout } from "./ProjectDetailLayout";

/** jsdom 探针：侧栏收起时主列限宽居中，展开时走原网格分支。 */
describe("ProjectDetailLayout", () => {
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
    window.localStorage.clear();
  });

  function render(mainKey?: string): void {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectDetailLayout
            sidebar={<div data-testid="side" />}
            mainKey={mainKey}
          >
            <div data-testid="main" />
          </ProjectDetailLayout>
        </NextIntlClientProvider>,
      );
    });
  }

  function remount(): void {
    act(() => root.unmount());
    root = createRoot(container);
    render();
  }

  /** testid → 主列 motion.div → 布局分支的容器 div（收起分支 / 网格）。 */
  function mainWrapper(): Element {
    const main = container.querySelector('[data-testid="main"]');
    if (!main) throw new Error("missing main");
    return main.parentElement!.parentElement!;
  }

  it("侧栏收起：主列带 max-w-[976px] + mx-auto；展开时网格分支不带", () => {
    window.localStorage.setItem("project-detail-sidebar-hidden", "1");
    render();

    const hiddenWrapper = mainWrapper();
    expect(hiddenWrapper.className).toContain("max-w-[976px]");
    expect(hiddenWrapper.className).toContain("mx-auto");

    window.localStorage.setItem("project-detail-sidebar-hidden", "0");
    remount();

    const shownWrapper = mainWrapper();
    expect(shownWrapper.className).not.toContain("max-w-[976px]");
    expect(shownWrapper.className).not.toContain("mx-auto");
    expect(shownWrapper.className).toContain("grid");
  });

  it("mainKey 变化：主列重挂做入场，侧栏 DOM 节点不重挂", () => {
    window.localStorage.setItem("project-detail-sidebar-hidden", "0");
    render("overview");

    const sideBefore = container.querySelector('[data-testid="side"]');
    // mainKey 挂在主列 motion.div 上（testid 的直接父节点），不是外层分支容器。
    const mainMotionBefore = container.querySelector(
      '[data-testid="main"]',
    )!.parentElement;
    expect(sideBefore).not.toBeNull();

    render("tasks");

    // 侧栏是常驻 chrome：同一 DOM 节点（layout 未重挂）。
    expect(container.querySelector('[data-testid="side"]')).toBe(sideBefore);
    // 主列 motion.div 随 mainKey 重挂（入场重放仅限主列）。
    expect(
      container.querySelector('[data-testid="main"]')!.parentElement,
    ).not.toBe(mainMotionBefore);
  });
});
