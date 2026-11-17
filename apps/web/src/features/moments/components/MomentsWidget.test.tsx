/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MomentView } from "../service";

/**
 * MomentsWidget 是 async RSC（getTranslations / getLocale），jsdom 无法直接挂载
 * async 组件；这里 mock 掉 next-intl/server 的请求上下文，用 zh/en 目录构造
 * translator，await 组件函数拿到元素后再交给 createRoot。断言的是真实组件
 * 输出（含 ICU 文案与 Intl 千分位），而不是另拆一层展示组件。
 *
 * locale 用 hoisted 的可变状态，en 用例切换目录即可覆盖 v1 未测的英文分支。
 */
const mockState = vi.hoisted(() => ({ locale: "zh" as "zh" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: zhMessages } = await import("@/i18n/messages/zh.json");
  const { default: enMessages } = await import("@/i18n/messages/en.json");

  return {
    // namespace 由 next-intl 的 key 联合收窄；测试只走 "moments"/"date"，此处放宽。
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: mockState.locale,
        messages: (mockState.locale === "en"
          ? enMessages
          : zhMessages) as never,
        namespace: namespace as never,
      }),
    getLocale: async () => mockState.locale,
  };
});

import { MomentsWidget } from "./MomentsWidget";

const TODAY = "2026-11-17";

/** 夹具：只覆盖用例关心的字段，其余给稳定默认值。 */
function momentView(
  overrides: Partial<MomentView> & { title: string },
): MomentView {
  const { title, ...rest } = overrides;

  return {
    id: title,
    title,
    pinned: false,
    mode: "countdown",
    cycle: null,
    anchorDate: "2026-12-01",
    weekday: null,
    dayOfMonth: null,
    direction: "upcoming",
    occurrenceDate: "2026-12-01",
    days: 0,
    ...rest,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mockState.locale = "zh";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

/** await async RSC 后把元素交给 createRoot（jsdom 不支持直接挂载 async 组件）。 */
async function renderWidget(moments: MomentView[]): Promise<void> {
  const element = await MomentsWidget({ moments, today: TODAY });
  act(() => {
    root.render(element);
  });
}

/** 按文案找链接，避免依赖 DOM 顺序。 */
function findLink(label: string): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find(
    (anchor) => anchor.textContent === label,
  );
}

/** 按名称找 pill 链接（管理全部/空态入口不含时刻名）。 */
function findPill(title: string): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find(
    (anchor) => anchor.textContent?.includes(title),
  );
}

/**
 * 计数区由 prefix / 大数字 / unit 三个 span 组成，视觉间距来自 flex gap，
 * textContent 本身没有空格；这里按 span 文本以空格拼接，断言可读的完整文案。
 */
function spansText(node: Element): string {
  return Array.from(node.querySelectorAll("span"))
    .map((span) => span.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/** 大数字 span（按格式化后的文本定位）。 */
function numberSpan(
  pill: Element,
  text: string,
): HTMLSpanElement | undefined {
  return Array.from(pill.querySelectorAll<HTMLSpanElement>("span")).find(
    (span) => span.textContent === text,
  );
}

describe("MomentsWidget", () => {
  it("空态渲染标题、说明与「去记录第一个时刻」链接，并指向模块页", async () => {
    await renderWidget([]);

    expect(container.textContent).toContain("时刻 · 置顶速览");
    expect(container.textContent).toContain("还没有记录的时刻");
    expect(container.textContent).toContain(
      "记录入职、退休、发薪日、纪念日……随时看到走了多远、还剩多久。",
    );

    expect(findLink("去记录第一个时刻")?.getAttribute("href")).toBe(
      "/space/personal/moments",
    );
    // 标题行右侧「管理全部」同样走 moduleHref。
    expect(findLink("管理全部")?.getAttribute("href")).toBe(
      "/space/personal/moments",
    );
  });

  it("倒计时 pill 使用 tone-down 色调、显示「还有 N 天」，且是模块链接", async () => {
    await renderWidget([
      momentView({
        title: "结婚纪念日",
        mode: "countdown",
        direction: "upcoming",
        days: 5678,
        anchorDate: "2037-05-01",
      }),
    ]);

    const pill = findPill("结婚纪念日");

    expect(pill?.getAttribute("href")).toBe("/space/personal/moments");
    expect(pill?.className).toContain("tone-down");
    expect(pill?.className).toContain("bg-[var(--warning-bg)]");
    expect(spansText(pill!)).toContain("还有 5,678 天");
    expect(numberSpan(pill!, "5,678")?.className).toContain(
      "text-[var(--moment-down-color)]",
    );
  });

  it("正计时 pill 使用 tone-up 色调并显示「已经 N 天」", async () => {
    await renderWidget([
      momentView({
        title: "入职",
        mode: "count_up",
        direction: "elapsed",
        days: 42,
        anchorDate: "2025-09-15",
      }),
    ]);

    const pill = findPill("入职");

    expect(pill?.className).toContain("tone-up");
    expect(pill?.className).toContain("bg-[var(--success-bg)]");
    expect(spansText(pill!)).toContain("已经 42 天");
    expect(numberSpan(pill!, "42")?.className).toContain(
      "text-[var(--moment-up-color)]",
    );
  });

  it("当天 pill 走「今天 0」分支并使用 tone-periodic 色调", async () => {
    await renderWidget([
      momentView({
        title: "每日站会",
        mode: "periodic",
        cycle: "daily",
        direction: "today",
        days: 0,
      }),
    ]);

    const pill = findPill("每日站会");

    expect(pill?.className).toContain("tone-periodic");
    expect(pill?.className).toContain("bg-[var(--primary-bg)]");
    expect(spansText(pill!)).toContain("今天 0 天");
    expect(spansText(pill!)).toContain("每天 · 循环");
  });

  it("周期·每周 pill 的副行展示完整「每周五 · 循环」文案", async () => {
    await renderWidget([
      momentView({
        title: "周末下班",
        mode: "periodic",
        cycle: "weekly",
        weekday: 5,
        direction: "upcoming",
        days: 3,
      }),
    ]);

    const pill = findPill("周末下班");
    // 星期名复用 `date` ns 的 WEEKDAY_KEYS（周五，已含「周」前缀），
    // 因此 zh 模板是「每{weekday}」而不是「每周{weekday}」。
    const desc = Array.from(pill!.querySelectorAll("span")).find(
      (span) => span.textContent === "每周五 · 循环",
    );

    expect(desc?.textContent).toBe("每周五 · 循环");
  });

  it("en 目录下大数字带千分位，unit 复数按原始数字解析", async () => {
    mockState.locale = "en";
    await renderWidget([
      momentView({
        title: "Anniversary",
        mode: "countdown",
        direction: "upcoming",
        days: 5678,
        anchorDate: "2037-05-01",
      }),
    ]);

    expect(container.textContent).toContain("Moments · pinned overview");

    const pill = findPill("Anniversary");

    // v1 的 zh 预格式化 / en 原始数分支：en 的 ICU 复数用原始数字选形，
    // 大数字展示仍按 locale 加千分位 → "in 5,678 days"。
    expect(spansText(pill!)).toContain("in 5,678 days");
  });
});
