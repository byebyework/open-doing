/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import zh from "@/i18n/messages/zh.json";

import { FeaturesSection } from "./FeaturesSection";

/**
 * 功能区最终 DOM 测试：jsdom + React 官方 act 最小探针（无 testing-library）。
 *
 * next/image 替换成原生 `img`（同 Hero.test.tsx）：静态资源经 Vite 解析后是
 * URL 字符串，不满足 Next 的 StaticImageData 契约；替换后 alt 断言仍覆盖
 * 生产渲染的最终语义。
 *
 * jsdom 不提供 IntersectionObserver，而 motion 的 whileInView 在挂载时直接
 * 构造观察器；这里注入一个空实现，避免抛错。断言只依赖 DOM 内容（文案、
 * alt、锚点），与动画是否已触发无关。
 */
vi.mock("next/image", () => ({
  default: function MockImage(props: {
    src: string | { src: string };
    alt?: string;
    className?: string;
  }) {
    const resolved =
      typeof props.src === "string" ? props.src : props.src.src;
    // eslint-disable-next-line @next/next/no-img-element -- 测试替身，非真实渲染路径
    return <img src={resolved} alt={props.alt ?? ""} className={props.className} />;
  },
}));

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

const FEATURE_KEYS = ["dashboard", "kanban", "calendar", "analysis"] as const;

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

function renderFeatures(): void {
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh}
        now={new Date("2026-11-11T00:00:00.000Z")}
      >
        <FeaturesSection />
      </NextIntlClientProvider>,
    );
  });
}

describe("FeaturesSection", () => {
  it("exposes the #features anchor for the nav scroll link", () => {
    renderFeatures();

    const section = container.querySelector<HTMLElement>(
      '[data-testid="landing-features"]',
    );
    expect(section).not.toBeNull();
    expect(section?.id).toBe("features");
    expect(section?.className).toContain("scroll-mt-16");
  });

  it("renders the section label and title from the landing catalog", () => {
    renderFeatures();

    expect(container.textContent).toContain(zh.landing.features.label);
    expect(container.querySelector("h2")?.textContent).toBe(
      zh.landing.features.title,
    );
  });

  it("renders the four feature modules in dashboard/kanban/calendar/analysis order", () => {
    renderFeatures();

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-feature]"),
    );
    expect(rows.map((row) => row.dataset.feature)).toEqual([...FEATURE_KEYS]);

    const tags = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="feature-tag"]'),
    ).map((tag) => tag.textContent);
    expect(tags).toEqual(
      FEATURE_KEYS.map((key) => zh.landing.features.items[key].tag),
    );

    const titles = Array.from(container.querySelectorAll("h3")).map(
      (heading) => heading.textContent,
    );
    expect(titles).toEqual(
      FEATURE_KEYS.map((key) => zh.landing.features.items[key].title),
    );

    const bodies = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="feature-body"]'),
    ).map((body) => body.textContent);
    expect(bodies).toEqual(
      FEATURE_KEYS.map((key) => zh.landing.features.items[key].body),
    );
  });

  it("renders each screenshot with the informative alt from the catalog", () => {
    renderFeatures();

    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(FEATURE_KEYS.length);
    expect(images.map((image) => image.getAttribute("alt"))).toEqual(
      FEATURE_KEYS.map((key) => zh.landing.features.items[key].alt),
    );
  });

  it("keeps the screenshot in the wide column on both alternation directions", () => {
    renderFeatures();

    function cells(key: (typeof FEATURE_KEYS)[number]): HTMLElement[] {
      const row = container.querySelector<HTMLElement>(
        `[data-feature="${key}"]`,
      );
      if (!row) throw new Error(`missing feature row: ${key}`);
      return Array.from(row.children) as HTMLElement[];
    }

    // 图片在右：copy(narrow) 在左列，shot(wide) 在右列。
    const dashboard = cells("dashboard");
    expect(dashboard[0]?.querySelector("img")).toBeNull();
    expect(dashboard[0]?.className).toContain("lg:order-1");
    expect(dashboard[1]?.querySelector("img")).not.toBeNull();
    expect(dashboard[1]?.className).toContain("lg:order-2");

    // 图片在左：模板必须镜像（shot 占 1.3fr 宽列、copy 占 0.85fr 窄列），
    // 仅交换 order 而模板不变会让截图落进窄列（Fix round 1 回归点）。
    const kanban = cells("kanban");
    expect(kanban[0]?.className).toContain("lg:order-2");
    expect(kanban[1]?.querySelector("img")).not.toBeNull();
    expect(kanban[1]?.className).toContain("lg:order-1");

    const kanbanRow = kanban[1]?.parentElement;
    expect(kanbanRow?.className).toContain(
      "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)]",
    );
    const dashboardRow = dashboard[1]?.parentElement;
    expect(dashboardRow?.className).toContain(
      "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)]",
    );
  });
});
