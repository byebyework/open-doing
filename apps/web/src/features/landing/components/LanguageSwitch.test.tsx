/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/features/auth/actions";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";

/**
 * 仓库 vitest 是 node 环境（无 @testing-library），交互组件测试沿用
 * overlay-motion.test.tsx 的 jsdom + React 官方 act 最小探针写法：
 * 真实挂载到 DOM、点击原生按钮、读 disabled/className。
 */
const { setAnonymousLocaleAction } = vi.hoisted(() => ({
  setAnonymousLocaleAction:
    vi.fn<(input: { locale: string }) => Promise<ActionResult<void>>>(),
}));

vi.mock("../actions", () => ({ setAnonymousLocaleAction }));

import { LanguageSwitch } from "./LanguageSwitch";

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

function renderSwitch(language: AppLocale): void {
  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh}
        now={new Date("2026-11-11T00:00:00.000Z")}
      >
        <LanguageSwitch language={language} />
      </NextIntlClientProvider>,
    );
  });
}

function button(locale: AppLocale): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    `[data-testid="language-switch-${locale}"]`,
  );
  if (!element) throw new Error(`missing ${locale} language button`);
  return element;
}

describe("LanguageSwitch", () => {
  it("clicking EN calls the anonymous locale action with { locale: 'en' }", async () => {
    setAnonymousLocaleAction.mockResolvedValue({ ok: true, data: undefined });
    renderSwitch("zh");

    await act(async () => {
      button("en").click();
    });

    expect(setAnonymousLocaleAction).toHaveBeenCalledTimes(1);
    expect(setAnonymousLocaleAction).toHaveBeenCalledWith({ locale: "en" });
  });

  it("disables both locale buttons while the change is pending", async () => {
    let resolve!: (result: ActionResult<void>) => void;
    setAnonymousLocaleAction.mockReturnValue(
      new Promise<ActionResult<void>>((done) => {
        resolve = done;
      }),
    );
    renderSwitch("zh");

    expect(button("zh").disabled).toBe(false);
    expect(button("en").disabled).toBe(false);

    await act(async () => {
      button("en").click();
    });

    expect(setAnonymousLocaleAction).toHaveBeenCalledWith({ locale: "en" });
    expect(button("zh").disabled).toBe(true);
    expect(button("en").disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true, data: undefined });
    });

    expect(button("zh").disabled).toBe(false);
    expect(button("en").disabled).toBe(false);
  });

  it("highlights the current locale with a semibold text-primary button", () => {
    renderSwitch("zh");

    expect(button("zh").getAttribute("aria-pressed")).toBe("true");
    expect(button("zh").className).toContain("font-semibold");
    expect(button("zh").className).toContain("text-primary");

    expect(button("en").getAttribute("aria-pressed")).toBe("false");
    expect(button("en").className).not.toContain("text-primary");
    expect(button("en").className).not.toContain("font-semibold");
  });

  it("labels the switch group with the landing nav language label", () => {
    renderSwitch("zh");

    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe(
      zh.landing.nav.languageLabel,
    );
  });
});
