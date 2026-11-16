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
import type { ImportantDayView } from "../service";

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
  createDayAction: createMock,
  updateDayAction: updateMock,
  deleteDayAction: deleteMock,
  toggleDayPinnedAction: toggleMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock, replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { DaysBoard } from "./DaysBoard";

const TODAY = "2026-11-16";

/** Radix Popper 在 layout 阶段无条件 new ResizeObserver（jsdom 未实现）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

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
  vi.useFakeTimers();
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

function renderBoard(days: ImportantDayView[]): void {
  act(() => {
    root.render(
      <NextIntlClientProvider locale={"zh" as AppLocale} messages={zh}>
        <DaysBoard initialDays={days} today={TODAY} />
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

/** Radix Tabs 在 mousedown 时切换（普通 click 不触发 onValueChange）。 */
function activateTab(element: Element | null): void {
  act(() => {
    element?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false }),
    );
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
  const button = find<HTMLButtonElement>('[data-testid="day-form-submit"]');
  if (!button) throw new Error("submit button missing");

  await act(async () => {
    button.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("DaysBoard", () => {
  it("渲染卡片墙：名称、倒计时大字、日期行与徽标", () => {
    renderBoard([
      dayView({ title: "爸爸生日", days: 23, pinned: true }),
      dayView({
        title: "春节",
        isLunar: true,
        repeat: "yearly",
        lunarMonth: 1,
        lunarDay: 1,
        anchorDate: null,
        occurrenceDate: "2027-02-06",
        days: 82,
      }),
    ]);

    expect(find('[data-testid="day-card-爸爸生日"]')?.textContent).toContain(
      "还有 23 天",
    );
    expect(find('[data-testid="day-card-爸爸生日"]')?.textContent).toContain(
      "2026-12-01",
    );
    expect(find('[data-testid="day-card-春节"]')?.textContent).toContain(
      "还有 82 天",
    );
    // 农历条目日期行展示换算后的发生日，而非空锚点。
    expect(find('[data-testid="day-card-春节"]')?.textContent).toContain(
      "2027-02-06",
    );
    expect(find('[data-testid="day-card-春节"]')?.textContent).toContain("农历");
    expect(find('[data-testid="day-card-春节"]')?.textContent).toContain("每年");
    // 置顶卡片的操作按钮是「取消置顶」，未置顶是「置顶」。
    expect(
      find('[data-testid="day-pin-爸爸生日"]')?.getAttribute("aria-label"),
    ).toBe("取消置顶 爸爸生日");
    expect(
      find('[data-testid="day-pin-春节"]')?.getAttribute("aria-label"),
    ).toBe("置顶 春节");
  });

  it("空态渲染引导文案与新建入口", () => {
    renderBoard([]);

    expect(document.body.textContent).toContain("还没有记录的日子");
    expect(document.body.textContent).toContain(
      "记录生日、纪念日、入职、退休……随时看到走了多远、还剩多久。",
    );
    expect(find('[data-testid="days-create-button"]')).not.toBeNull();
    expect(
      document.body.querySelectorAll('[data-testid^="day-card-"]').length,
    ).toBe(0);
  });

  it("新建农历日子：提交归一化 input（repeat=yearly、date=null、月日为数字）", async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: dayView({
        title: "农历生日",
        isLunar: true,
        repeat: "yearly",
        lunarMonth: 3,
        lunarDay: 12,
        anchorDate: null,
      }),
    });
    renderBoard([]);

    click(find('[data-testid="days-create-button"]'));

    const title = find<HTMLInputElement>('[data-testid="day-form-title"]');
    if (!title) throw new Error("title input missing");
    setInputValue(title, "  农历生日  ");

    activateTab(find('[data-testid="day-form-type-lunar"]'));
    selectOption('[data-testid="day-form-month"]', "3");
    selectOption('[data-testid="day-form-day"]', "12");

    // 农历模式下「每年重复」锁定为选中且禁用，并展示说明。
    const repeat = find<HTMLElement>('[data-testid="day-form-repeat"]');
    expect(repeat?.getAttribute("aria-checked")).toBe("true");
    expect(repeat?.getAttribute("data-state")).toBe("checked");
    expect((repeat as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(document.body.textContent).toContain("农历日子每年自动滚动");

    await submitForm();

    expect(createMock).toHaveBeenCalledWith({
      title: "农历生日",
      date: null,
      isLunar: true,
      lunarMonth: 3,
      lunarDay: 12,
      repeat: "yearly",
      pinned: false,
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("编辑弹窗回填 initial：名称、日期与每年重复", () => {
    const solar = dayView({
      title: "结婚纪念日",
      anchorDate: "2020-05-20",
      occurrenceDate: "2027-05-20",
      repeat: "yearly",
      days: 186,
    });
    renderBoard([solar]);

    click(find('[data-testid="day-edit-结婚纪念日"]'));

    const title = find<HTMLInputElement>('[data-testid="day-form-title"]');
    const date = find<HTMLInputElement>('[data-testid="day-form-date"]');
    expect(title?.value).toBe("结婚纪念日");
    expect(date?.value).toBe("2020-05-20");
    expect(
      find('[data-testid="day-form-repeat"]')?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("编辑保存：成功后关闭并刷新，退场保持窗口内标题与表单值不翻转", async () => {
    const target = dayView({
      title: "结婚纪念日",
      anchorDate: "2020-05-20",
      occurrenceDate: "2027-05-20",
      repeat: "yearly",
      days: 186,
    });
    updateMock.mockResolvedValue({
      ok: true,
      data: { ...target, title: "纪念日改名" },
    });
    renderBoard([target]);

    click(find('[data-testid="day-edit-结婚纪念日"]'));
    const title = find<HTMLInputElement>('[data-testid="day-form-title"]');
    if (!title) throw new Error("title input missing");
    setInputValue(title, "纪念日改名");

    await submitForm();

    expect(updateMock).toHaveBeenCalledWith(
      "结婚纪念日",
      expect.objectContaining({ title: "纪念日改名" }),
    );
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // 退场窗口内 initial 仍为旧目标：标题保持「编辑日子」、输入值不被重置。
    expect(find('[data-slot="dialog-title"]')?.textContent).toBe("编辑日子");
    expect(find<HTMLInputElement>('[data-testid="day-form-title"]')?.value).toBe(
      "纪念日改名",
    );

    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="dialog-content"]')).toBeNull();
  });

  it("字段错误回填到对应 input 的 aria 描述", async () => {
    createMock.mockResolvedValue({
      ok: false,
      errors: { title: "名称不能超过 50 个字符" },
    });
    renderBoard([]);

    click(find('[data-testid="days-create-button"]'));

    const title = find<HTMLInputElement>('[data-testid="day-form-title"]');
    if (!title) throw new Error("title input missing");
    setInputValue(title, "超长名称");

    await submitForm();

    expect(title.getAttribute("aria-describedby")).toBe("day-form-title-error");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(find("#day-form-title-error")?.textContent).toBe(
      "名称不能超过 50 个字符",
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("删除：ConfirmModal 确认后调用 deleteDayAction，loading 期间不可重复提交", async () => {
    let resolveDelete: ((value: unknown) => void) | null = null;
    deleteMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const target = dayView({ title: "搬家", days: 12 });
    renderBoard([target]);

    click(find('[data-testid="day-delete-搬家"]'));

    const confirm = find<HTMLButtonElement>('[data-testid="day-delete-confirm"]');
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
    expect(find('[data-slot="alert-dialog-title"]')?.textContent).toContain(
      "搬家",
    );

    // 成功分支关闭弹窗；退场保持窗口结束后内容卸载。
    act(() => {
      vi.advanceTimersByTime(OD_MS.modalOut + 50);
    });
    expect(find('[data-slot="alert-dialog-content"]')).toBeNull();
  });
});
