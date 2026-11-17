/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OD_MS } from "@/components/ui/overlay-motion";
import type { AppLocale } from "@/i18n/config";
import zh from "@/i18n/messages/zh.json";
import type { MomentView } from "../service";

const {
  createMock,
  updateMock,
  deleteMock,
  toggleMock,
  refreshMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  toggleMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("../actions", () => ({
  createMomentAction: createMock,
  updateMomentAction: updateMock,
  deleteMomentAction: deleteMock,
  toggleMomentPinnedAction: toggleMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock, replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { MomentsBoard } from "./MomentsBoard";
import { NewMomentButton } from "./NewMomentButton";

const TODAY = "2026-11-17";

/** Radix Popper 在 layout 阶段无条件 new ResizeObserver（jsdom 未实现）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** 夹具：只覆盖用例关心的字段，其余给稳定默认值。 */
function momentView(
  overrides: Partial<MomentView> & { title: string },
): MomentView {
  const { title, ...rest } = overrides;

  return {
    id: title,
    title,
    pinned: false,
    mode: "count_up",
    cycle: null,
    anchorDate: "2025-09-15",
    weekday: null,
    dayOfMonth: null,
    direction: "elapsed",
    occurrenceDate: "2025-09-15",
    days: 428,
    ...rest,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  // 固定「今天」：表单默认锚点日取 Asia/Shanghai 口径（04:00Z = 12:00 UTC+8）。
  vi.setSystemTime(new Date("2026-11-17T04:00:00Z"));
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderBoard(moments: MomentView[]): void {
  act(() => {
    root.render(
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <MomentsBoard initialMoments={moments} today={TODAY} />
      </NextIntlClientProvider>,
    );
  });
}

/** 模块页组合：页头新建按钮 + 卡片墙（与 RSC 页面一致）。 */
function renderPage(moments: MomentView[]): void {
  act(() => {
    root.render(
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <NewMomentButton />
        <MomentsBoard initialMoments={moments} today={TODAY} />
      </NextIntlClientProvider>,
    );
  });
}

function find<T extends Element = Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

/** React 的受控 input 需要绕过 value tracker：用原型 setter 赋值后派发 input。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: Element | null): void {
  act(() => {
    (element as HTMLElement | null)?.click();
  });
}

/** 打开下拉并点选指定文案的选项（Radix Select 普通 click 即触发）。 */
function selectOption(triggerSelector: string, label: string): void {
  click(find(triggerSelector));

  const contents = document.body.querySelectorAll('[data-slot="select-content"]');
  const items = contents[contents.length - 1]?.querySelectorAll(
    '[data-slot="select-item"]',
  );

  const item = Array.from(items ?? []).find(
    (candidate) => candidate.textContent === label,
  );
  if (!item) throw new Error(`select option ${label} missing`);

  click(item);
  // 让退场保持窗口结束，避免上一个 Select 的内容残留在后续查询里。
  act(() => {
    vi.advanceTimersByTime(OD_MS.popOut + 50);
  });
}

/** 提交表单后冲刷 action 的 Promise 与 setState。 */
async function submitForm(): Promise<void> {
  const button = find<HTMLButtonElement>('[data-testid="moment-form-submit"]');
  if (!button) throw new Error("submit button missing");

  await act(async () => {
    button.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MomentsBoard", () => {
  it("渲染卡片墙：名称、置顶 / 模式徽标、大数字与副行", () => {
    renderBoard([
      momentView({
        title: "距离周末",
        pinned: true,
        mode: "periodic",
        cycle: "weekly",
        anchorDate: "2026-11-06",
        weekday: 5,
        direction: "upcoming",
        occurrenceDate: "2026-11-20",
        days: 3,
      }),
      momentView({
        title: "入职 Open Doing",
        days: 428,
      }),
      momentView({
        title: "距离退休",
        mode: "countdown",
        anchorDate: "2031-06-30",
        direction: "upcoming",
        occurrenceDate: "2031-06-30",
        days: 1690,
      }),
    ]);

    const weekly = find('[data-testid="moment-card-距离周末"]');
    expect(weekly?.textContent).toContain("置顶");
    expect(weekly?.textContent).toContain("每周五 · 循环");
    expect(weekly?.textContent).toContain("还有");
    expect(weekly?.textContent).toContain("天");
    expect(weekly?.textContent).toContain("每周五 · 下次 11月20日");
    // 图钉 = 取消置顶（实心），aria-pressed 反映真实布尔。
    const pin = find('[data-testid="moment-pin-距离周末"]');
    expect(pin?.getAttribute("aria-label")).toBe("取消置顶");
    expect(pin?.getAttribute("aria-pressed")).toBe("true");

    const up = find('[data-testid="moment-card-入职 Open Doing"]');
    expect(up?.textContent).toContain("正计时");
    expect(up?.textContent).toContain("已经");
    expect(up?.textContent).toContain("428");
    expect(up?.textContent).toContain("9月15日 至今");

    const down = find('[data-testid="moment-card-距离退休"]');
    expect(down?.textContent).toContain("倒计时");
    expect(down?.textContent).toContain("1,690");
    expect(down?.textContent).toContain("目标 6月30日");
    expect(
      find('[data-testid="moment-pin-距离退休"]')?.getAttribute("aria-label"),
    ).toBe("置顶");
  });

  it("空态渲染引导文案，且不渲染卡片", () => {
    renderBoard([]);

    expect(document.body.textContent).toContain("还没有记录的时刻");
    expect(document.body.textContent).toContain(
      "记录入职、退休、发薪日、纪念日……随时看到走了多远、还剩多久。",
    );
    expect(
      document.body.querySelectorAll('[data-testid^="moment-card-"]').length,
    ).toBe(0);
  });

  it("新建周期（每月）：提交归一化 payload（cycle/dayOfMonth 落库、真实 pinned）", async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: momentView({
        title: "发薪日",
        mode: "periodic",
        cycle: "monthly",
        dayOfMonth: 15,
        direction: "upcoming",
        occurrenceDate: "2026-12-15",
        days: 28,
      }),
    });
    renderPage([]);

    click(find('[data-testid="moments-create-button"]'));

    const title = find<HTMLInputElement>('[data-testid="moment-form-title"]');
    if (!title) throw new Error("title input missing");
    setInputValue(title, "  发薪日  ");

    // 原型默认即「周期计时 · 每月」；三档面板互斥由 aria-pressed 表达。
    expect(
      find('[data-testid="moment-form-mode-periodic"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      find('[data-testid="moment-form-cycle-monthly"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(find('[data-testid="moment-form-monthday"]')).not.toBeNull();
    expect(find('[data-testid="moment-form-date"]')).toBeNull();

    const monthDay = find<HTMLInputElement>('[data-testid="moment-form-monthday"]');
    if (!monthDay) throw new Error("monthday input missing");
    setInputValue(monthDay, "15");

    await submitForm();

    expect(createMock).toHaveBeenCalledWith({
      title: "发薪日",
      mode: "periodic",
      cycle: "monthly",
      anchorDate: TODAY,
      weekday: null,
      dayOfMonth: 15,
      pinned: true,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("编辑弹窗回填 initial：名称、模式、周期与周几", () => {
    const weekly = momentView({
      title: "距离周末",
      mode: "periodic",
      cycle: "weekly",
      weekday: 5,
      anchorDate: "2026-11-06",
      direction: "upcoming",
      occurrenceDate: "2026-11-20",
      days: 3,
    });
    renderBoard([weekly]);

    click(find('[data-testid="moment-edit-距离周末"]'));

    expect(
      find<HTMLInputElement>('[data-testid="moment-form-title"]')?.value,
    ).toBe("距离周末");
    expect(
      find('[data-testid="moment-form-mode-periodic"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      find('[data-testid="moment-form-cycle-weekly"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      find('[data-testid="moment-form-weekday"]')?.textContent,
    ).toContain("周五");
    // 编辑态显示置顶复选框（新建态没有）。
    expect(
      find('[data-testid="moment-form-pinned"]')?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("编辑保存：成功后关闭并刷新，退场保持窗口内标题与表单值不翻转", async () => {
    const target = momentView({
      title: "入职 Open Doing",
      pinned: true,
    });
    updateMock.mockResolvedValue({
      ok: true,
      data: { ...target, title: "入职改名" },
    });
    renderBoard([target]);

    click(find('[data-testid="moment-edit-入职 Open Doing"]'));
    const title = find<HTMLInputElement>('[data-testid="moment-form-title"]');
    if (!title) throw new Error("title input missing");
    setInputValue(title, "入职改名");

    await submitForm();

    expect(updateMock).toHaveBeenCalledWith(
      "入职 Open Doing",
      expect.objectContaining({ title: "入职改名", mode: "count_up" }),
    );
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // 退场窗口内 initial 仍为旧目标：标题保持「编辑时刻」、输入值不被重置。
    expect(find('[data-slot="dialog-title"]')?.textContent).toBe("编辑时刻");
    expect(find<HTMLInputElement>('[data-testid="moment-form-title"]')?.value).toBe(
      "入职改名",
    );

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="dialog-content"]')).toBeNull();
  });

  it("字段错误回填到名称输入框的 aria 描述", async () => {
    createMock.mockResolvedValue({
      ok: false,
      errors: { title: "名称不能超过 50 个字符" },
    });
    renderPage([]);

    click(find('[data-testid="moments-create-button"]'));

    const title = find<HTMLInputElement>('[data-testid="moment-form-title"]');
    if (!title) throw new Error("title input missing");
    setInputValue(title, "超长名称");

    await submitForm();

    expect(title.getAttribute("aria-describedby")).toBe(
      "moment-form-title-error",
    );
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(find("#moment-form-title-error")?.textContent).toBe(
      "名称不能超过 50 个字符",
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("置顶：图钉调用 toggleMomentPinnedAction 并携带真实布尔", async () => {
    toggleMock.mockResolvedValue({ ok: true, data: null });
    renderBoard([momentView({ title: "距离退休", mode: "countdown" })]);

    click(find('[data-testid="moment-pin-距离退休"]'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(toggleMock).toHaveBeenCalledWith("距离退休", true);
    expect(toggleMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("删除：ConfirmModal 确认后调用 deleteMomentAction，loading 防双发且退场标题稳定", async () => {
    let resolveDelete: ((value: unknown) => void) | null = null;
    deleteMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const target = momentView({
      title: "搬家",
      anchorDate: "2026-11-05",
      direction: "elapsed",
      days: 12,
    });
    renderBoard([target]);

    click(find('[data-testid="moment-delete-搬家"]'));

    const confirm = find<HTMLButtonElement>(
      '[data-testid="moment-delete-confirm"]',
    );
    if (!confirm) throw new Error("confirm button missing");

    click(confirm);
    // 第二次点击应被 loading 禁用挡住（消费方与 ConfirmModal 双重闸门）。
    click(confirm);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith("搬家");
    expect(confirm.disabled).toBe(true);

    await act(async () => {
      resolveDelete?.({ ok: true, data: null });
      await Promise.resolve();
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);

    // 退场保持窗口内标题保持稳定（目标对象不在关闭时清空），不闪成空标题。
    expect(find('[data-slot="alert-dialog-title"]')?.textContent).toBe(
      "删除「搬家」？",
    );

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="alert-dialog-content"]')).toBeNull();
  });
});
