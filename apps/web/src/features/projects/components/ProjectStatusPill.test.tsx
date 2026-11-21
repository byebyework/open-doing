/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

import { ProjectStatusPill } from "./ProjectStatusPill";

/**
 * jsdom 探针写法（同 ProjectStatsCard.test.tsx）。
 *
 * 覆盖:五选项渲染与图标顺序、当前项勾选、onChange 回调值、无 onChange 只展示。
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

describe("ProjectStatusPill", () => {
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

  function render(status: Parameters<typeof ProjectStatusPill>[0]["status"], onChange?: (s: Parameters<typeof ProjectStatusPill>[0]["status"]) => void) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
          <ProjectStatusPill status={status} onChange={onChange} />
        </NextIntlClientProvider>,
      );
    });
  }

  function click(testid: string) {
    const button = document.body.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
    if (!button) throw new Error(`missing button ${testid}`);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("点击 pill 展开五个选项（图标+名称），当前项打勾", () => {
    render("in_progress");
    click("project-status-pill");

    const options = document.body.querySelectorAll('[data-testid^="project-status-option-"]');
    expect(options).toHaveLength(5);
    const names = Array.from(options).map((o) => o.textContent);
    expect(names[0]).toContain("待办");
    expect(names[2]).toContain("进行中");
    // 当前项打勾
    const current = document.body.querySelector('[data-testid="project-status-option-in_progress"]');
    expect(current?.querySelector("svg")).not.toBeNull();
  });

  it("onChange：选项点击即回调新状态", () => {
    const onChange = vi.fn();
    render("backlog", onChange);
    click("project-status-pill");
    click("project-status-option-canceled");
    expect(onChange).toHaveBeenCalledWith("canceled");
  });

  it("无 onChange：pill 仅展示，点击仍展开但选项点击不报错", () => {
    render("completed");
    const pill = document.body.querySelector<HTMLButtonElement>('[data-testid="project-status-pill"]')!;
    expect(pill.textContent).toContain("已完成");
    click("project-status-pill");
    click("project-status-option-planned");
  });
});
