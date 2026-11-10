/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

/**
 * LandingNav 是 async RSC（getTranslations / getRequestLocale），jsdom 里
 * 无法直接挂载；本文件改测它拆出的纯展示层 LandingNavView：RSC 外壳只把
 * zh 消息包里的 landing.nav.* 文案透传成 props，这里照实传 zh 目录文案。
 * LanguageSwitch 的 import 链会带进 "use server" 的 ../actions，照
 * LanguageSwitch.test.tsx 的惯例 mock 掉。
 */
const { setAnonymousLocaleAction } = vi.hoisted(() => ({
  setAnonymousLocaleAction: vi.fn(),
}));

vi.mock("../actions", () => ({ setAnonymousLocaleAction }));

import { LandingNavView } from "./LandingNavView";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function renderView(): void {
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh}
        now={new Date("2026-11-11T00:00:00.000Z")}
      >
        {/* 跳转链接的落点：真实页面由 LandingPage 渲染同 id 的 main */}
        <main id="main-content" tabIndex={-1} />
        <LandingNavView
          skipToContent={zh.landing.nav.skipToContent}
          brandLabel={zh.landing.nav.brand}
          primaryNavLabel={zh.landing.nav.primaryNav}
          links={[
            { href: "#features", label: zh.landing.nav.features },
            { href: "#audiences", label: zh.landing.nav.audiences },
            { href: "#faq", label: zh.landing.nav.faq },
          ]}
          loginLabel={zh.landing.nav.login}
          startLabel={zh.landing.nav.start}
          language={"zh" as AppLocale}
        />
      </NextIntlClientProvider>,
    );
  });
}

describe("LandingNavView（DOM 结构）", () => {
  it("skip link 是文档顺序里第一个可聚焦元素，指向 #main-content", () => {
    renderView();

    const firstAnchor = container.querySelector("a");
    expect(firstAnchor).not.toBeNull();
    expect(firstAnchor?.getAttribute("href")).toBe("#main-content");
    expect(firstAnchor?.textContent).toBe(zh.landing.nav.skipToContent);
  });

  it("跳转目标 id=main-content 在文档中存在", () => {
    renderView();

    expect(document.getElementById("main-content")).not.toBeNull();
  });

  it("品牌链接带 landing.nav.brand 的 aria-label", () => {
    renderView();

    const brand = container.querySelector("a[aria-label]");
    expect(brand?.getAttribute("aria-label")).toBe(zh.landing.nav.brand);
  });

  it("中部锚点挂在带 landing.nav.primaryNav aria-label 的 nav 地标内", () => {
    renderView();

    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe(zh.landing.nav.primaryNav);
    expect(nav?.querySelectorAll("a")).toHaveLength(3);
  });
});
