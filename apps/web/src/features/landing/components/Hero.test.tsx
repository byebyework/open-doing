/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetAndTransition } from "motion/react";

import zh from "@/i18n/messages/zh.json";

import { OD_EASE } from "../../../components/ui/overlay-motion";
import { fadeUp, staggerContainer } from "../motion-presets";
import { HeroAnimated, type HeroCopy } from "./HeroAnimated";

/**
 * 首屏最终 DOM 测试：jsdom + React 官方 act 最小探针（无 testing-library），
 * 真实挂载 `HeroAnimated`（含 motion 组件）。
 *
 * next/image 在测试环境替换成原生 `img`：静态资源经 Vite 解析后是 URL
 * 字符串，不满足 Next 的 StaticImageData 契约；替换后断言 alt 仍覆盖
 * 生产渲染的最终 DOM 语义。
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

const heroCopy: HeroCopy = zh.landing.hero;

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

function renderHero(copy: HeroCopy = heroCopy): void {
  act(() => {
    root.render(<HeroAnimated copy={copy} />);
  });
}

describe("HeroAnimated", () => {
  it("renders the hero section with the two H1 lines", () => {
    renderHero();

    expect(
      container.querySelector('[data-testid="landing-hero"]'),
    ).not.toBeNull();

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe(heroCopy.titleLine1 + heroCopy.titleLine2);

    const lines = h1?.querySelectorAll("span") ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]?.textContent).toBe(heroCopy.titleLine1);
    expect(lines[1]?.textContent).toBe(heroCopy.titleLine2);
    expect(lines[1]?.className).toContain("bg-clip-text");
  });

  it("renders the badge, subtitle and trust line", () => {
    renderHero();

    expect(container.textContent).toContain(heroCopy.badge);
    expect(container.textContent).toContain(heroCopy.subtitle);
    expect(container.textContent).toContain(heroCopy.trust);
  });

  it("links the primary CTA to /register and the secondary CTA to /login", () => {
    renderHero();

    const register = container.querySelector<HTMLAnchorElement>(
      'a[href="/register"]',
    );
    expect(register).not.toBeNull();
    expect(register?.textContent).toBe(heroCopy.ctaStart);

    const login = container.querySelector<HTMLAnchorElement>('a[href="/login"]');
    expect(login).not.toBeNull();
    expect(login?.textContent).toBe(heroCopy.ctaLogin);
  });

  it("shows the reminder card text on both responsive layouts", () => {
    renderHero();

    // 按分支分别断言（不依赖「恰好两张」的计数）：后续 DOM 合并时仍各自校验文案。
    const mobile = container.querySelector(
      '[data-testid="hero-reminder-mobile"]',
    );
    expect(mobile?.textContent).toBe(heroCopy.reminderCard);

    const desktop = container.querySelector(
      '[data-testid="hero-reminder-desktop"]',
    );
    expect(desktop?.textContent).toBe(heroCopy.reminderCard);
  });

  it("marks the two collage screenshots decorative with an empty alt", () => {
    renderHero();

    const images = container.querySelectorAll("img");
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const image of images) {
      expect(image.getAttribute("alt")).toBe("");
    }
  });

  it("takes all visible copy from props (no hardcoded strings)", () => {
    renderHero({
      badge: "copy-badge",
      titleLine1: "copy-title-line-1",
      titleLine2: "copy-title-line-2",
      subtitle: "copy-subtitle",
      ctaStart: "copy-cta-start",
      ctaLogin: "copy-cta-login",
      trust: "copy-trust",
      reminderCard: "copy-reminder-card",
    });

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("copy-title-line-1copy-title-line-2");
    expect(container.textContent).toContain("copy-badge");
    expect(container.textContent).toContain("copy-subtitle");
    expect(container.textContent).toContain("copy-trust");
    expect(container.textContent).toContain("copy-reminder-card");
    expect(
      container.querySelector('a[href="/register"]')?.textContent,
    ).toBe("copy-cta-start");
    expect(
      container.querySelector('a[href="/login"]')?.textContent,
    ).toBe("copy-cta-login");
  });
});

describe("landing motion presets", () => {
  it("fadeUp moves 24px up into place with the decelerate curve", () => {
    const hidden = fadeUp.hidden as TargetAndTransition;
    const visible = fadeUp.visible as TargetAndTransition;

    expect(hidden).toMatchObject({ opacity: 0, y: 24 });
    expect(visible).toMatchObject({ opacity: 1, y: 0 });
    expect(visible.transition).toMatchObject({ ease: OD_EASE.decelerate });
  });

  it("staggerContainer triggers children every 80ms", () => {
    const visible = staggerContainer.visible as TargetAndTransition;
    expect(visible.transition).toMatchObject({ staggerChildren: 0.08 });
  });
});
