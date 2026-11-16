/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportantDayView } from "../service";

/**
 * DaysWidget 是 async RSC（getTranslations / getLocale），jsdom 无法直接挂载
 * async 组件；这里 mock 掉 next-intl/server 的请求上下文，用 zh 目录构造
 * translator，await 组件函数拿到元素后再交给 createRoot。断言的是真实组件
 * 输出（含 ICU 文案与 Intl 千分位），而不是另拆一层展示组件。
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("@/i18n/messages/zh.json");

  return {
    // namespace 由 next-intl 的 key 联合收窄；测试只走 "days"，此处放宽。
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "zh", messages, namespace: namespace as never }),
    getLocale: async () => "zh",
  };
});

import { DaysWidget } from "./DaysWidget";

const TODAY = "2026-11-16";

/** 夹具：只覆盖用例关心的字段，其余给稳定默认值。 */
function dayView(
  overrides: Partial<ImportantDayView> & { title: string },
): ImportantDayView {
  const { title, ...rest } = overrides;

  return {
    id: title,
    title,
    pinned: false,
    isLunar: false,
    repeat: "none",
    anchorDate: "2026-12-01",
    lunarMonth: null,
    lunarDay: null,
    direction: "upcoming",
    occurrenceDate: "2026-12-01",
    days: 0,
    ...rest,
  };
}

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

/** await async RSC 后把元素交给 createRoot（jsdom 不支持直接挂载 async 组件）。 */
async function renderWidget(days: ImportantDayView[]): Promise<void> {
  const element = await DaysWidget({ days, today: TODAY });
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

describe("DaysWidget", () => {
  it("空态渲染标题、说明与「去记录第一天」链接，并指向模块页", async () => {
    await renderWidget([]);

    expect(container.textContent).toContain("我的日子");
    expect(container.textContent).toContain("还没有记录的日子");
    expect(container.textContent).toContain(
      "记录生日、纪念日、入职、退休……随时看到走了多远、还剩多久。",
    );

    expect(findLink("去记录第一天")?.getAttribute("href")).toBe(
      "/space/personal/days",
    );
    // 标题行右侧「查看全部」同样走 moduleHref。
    expect(findLink("查看全部")?.getAttribute("href")).toBe(
      "/space/personal/days",
    );
  });

  it("倒计时项渲染「还有 N 天」，天数按 locale 加千分位", async () => {
    await renderWidget([
      dayView({ title: "结婚纪念日", days: 5678, direction: "upcoming" }),
    ]);

    expect(container.textContent).toContain("结婚纪念日");
    expect(container.textContent).toContain("还有 5,678 天");
  });

  it("正计时项渲染「已 N 天」", async () => {
    await renderWidget([
      dayView({ title: "入职", days: 42, direction: "elapsed" }),
    ]);

    expect(container.textContent).toContain("入职");
    expect(container.textContent).toContain("已 42 天");
  });

  it("days 为 0 走「就是今天」分支，不渲染倒计时/正计时文案", async () => {
    await renderWidget([
      dayView({ title: "爸爸生日", days: 0, direction: "upcoming" }),
    ]);

    expect(container.textContent).toContain("就是今天");
    expect(container.textContent).not.toContain("还有 0 天");
    expect(container.textContent).not.toContain("已 0 天");
  });

  it("农历条目的徽标同时显示「农历」与「每年」", async () => {
    await renderWidget([
      dayView({
        title: "春节",
        isLunar: true,
        repeat: "yearly",
        lunarMonth: 1,
        lunarDay: 1,
        anchorDate: null,
        days: 88,
      }),
    ]);

    expect(container.textContent).toContain("农历");
    expect(container.textContent).toContain("每年");
  });

  it("仅每年重复的公历条目只显示「每年」，不显示「农历」", async () => {
    await renderWidget([
      dayView({ title: "生日", repeat: "yearly", days: 30 }),
    ]);

    expect(container.textContent).toContain("每年");
    expect(container.textContent).not.toContain("农历");
  });

  it("一次性条目（非农历、不重复）不渲染任何徽标", async () => {
    await renderWidget([dayView({ title: "搬家", days: 12 })]);

    expect(container.textContent).not.toContain("每年");
    expect(container.textContent).not.toContain("农历");
  });
});
