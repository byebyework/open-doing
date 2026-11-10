/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";

import { FaqSection } from "./FaqSection";

/**
 * FAQ 手风琴最终 DOM 测试：jsdom + React 官方 act 最小探针（无 testing-library）。
 *
 * jsdom 不提供 IntersectionObserver，而头部/区块的 whileInView 在挂载时会
 * 直接构造观察器；这里注入一个空实现，避免抛错。断言只读最终 DOM
 * （aria-expanded、答案节点、锚点 id），不依赖动画帧。
 */
class StubIntersectionObserver {
  // motion 会传 callback / options，JS 侧忽略多余实参即可。
  constructor() {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const FAQ_KEYS = ["free", "solo", "install"] as const;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderFaq(): void {
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh}
        now={new Date("2026-11-11T00:00:00.000Z")}
      >
        <FaqSection />
      </NextIntlClientProvider>,
    );
  });
}

function trigger(key: (typeof FAQ_KEYS)[number]): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    `[data-testid="faq-trigger-${key}"]`,
  );
  if (!element) throw new Error(`missing FAQ trigger: ${key}`);
  return element;
}

function answer(key: (typeof FAQ_KEYS)[number]): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-testid="faq-answer-${key}"]`,
  );
}

/** 读原生 aria-expanded 属性（React 布尔 prop 会渲染成 "true"/"false"）。 */
function isExpanded(key: (typeof FAQ_KEYS)[number]): boolean {
  return trigger(key).getAttribute("aria-expanded") === "true";
}

function pressKey(key: string, element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("FaqSection", () => {
  it("exposes the #faq anchor for the nav scroll link", () => {
    renderFaq();

    const section = container.querySelector<HTMLElement>(
      '[data-testid="landing-faq"]',
    );
    expect(section).not.toBeNull();
    expect(section?.id).toBe("faq");
    expect(section?.className).toContain("scroll-mt-16");
  });

  it("renders the label, title and all three questions from the landing catalog", () => {
    renderFaq();

    expect(container.textContent).toContain(zh.landing.faq.label);
    expect(container.querySelector("h2")?.textContent).toBe(
      zh.landing.faq.title,
    );

    for (const key of FAQ_KEYS) {
      expect(trigger(key).textContent).toContain(
        zh.landing.faq.items[key].q,
      );
    }
  });

  it("opens the first item by default and keeps the others closed", () => {
    renderFaq();

    expect(isExpanded("free")).toBe(true);
    expect(answer("free")?.textContent).toBe(zh.landing.faq.items.free.a);

    expect(isExpanded("solo")).toBe(false);
    expect(isExpanded("install")).toBe(false);
    expect(answer("solo")).toBeNull();
    expect(answer("install")).toBeNull();
  });

  it("moves the open state to the second question when it is clicked", () => {
    renderFaq();

    act(() => trigger("solo").click());

    expect(isExpanded("solo")).toBe(true);
    expect(answer("solo")?.textContent).toBe(zh.landing.faq.items.solo.a);
    // 单开手风琴：第一项在 DOM 上语义收起（退出动画节点可能暂存，故读 aria）。
    expect(isExpanded("free")).toBe(false);
  });

  it("toggles the same question closed on a second click", () => {
    renderFaq();

    act(() => trigger("solo").click());
    expect(isExpanded("solo")).toBe(true);

    act(() => trigger("solo").click());
    expect(isExpanded("solo")).toBe(false);
  });

  it("toggles with the keyboard Enter and Space keys", () => {
    renderFaq();

    pressKey("Enter", trigger("solo"));
    expect(isExpanded("solo")).toBe(true);
    expect(answer("solo")?.textContent).toBe(zh.landing.faq.items.solo.a);

    pressKey(" ", trigger("solo"));
    expect(isExpanded("solo")).toBe(false);

    pressKey(" ", trigger("install"));
    expect(isExpanded("install")).toBe(true);
    expect(answer("install")?.textContent).toBe(
      zh.landing.faq.items.install.a,
    );
    expect(isExpanded("free")).toBe(false);
  });
});
