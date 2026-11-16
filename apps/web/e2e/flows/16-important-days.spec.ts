import { expect, test, type Page } from "@playwright/test";

import {
  registerUser,
  shanghaiToday,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 16：个人空间「重要日子」（v1.2 新模块）。
 *
 * 覆盖：
 * 1. 新用户个人 Dashboard 底部的「我的日子」小组件处于空态（空态入口
 *    「去记录第一天」直达模块页）；个人侧栏有「重要日子」入口；
 * 2. 模块页新建公历倒计时（名称 + 未来日期）：卡片显示日期行与倒计时；
 *    回到 Dashboard 小组件出现同名条目与倒计时文案（「查看全部」回模块页）；
 * 3. 新建农历生日：卡片带「农历」+「每年」徽标，公历/农历切换后
 *    「每年重复」复选框锁定且不可改；
 * 4. 置顶：置顶当前排序第二的卡片后它升到第一位（排序由服务端决定）；
 * 5. 编辑改名、删除（ConfirmModal 成功后关闭）后卡片消失；清空后回到空态，
 *    刷新页面仍为空（删除已持久化）。
 *
 * 日期一律以 `shanghaiToday()`（与页面 `todayInShanghai()` 同口径）派生，
 * 倒计时天数只断言稳定文案形态，不钉死具体数字——用例可在任意日期运行。
 */

test.describe.configure({ timeout: 120_000 });

/** 个人侧栏 / 模块标题的「重要日子」文案（zh 消息包）。 */
const DAYS_NAV_LABEL = "重要日子";

/** 模块页卡片墙的全部卡片（`data-testid` 由组件侧硬编码为 `day-card-<id>`）。 */
function dayCards(page: Page) {
  return page.locator('article[data-testid^="day-card-"]');
}

/** 按卡片标题定位单张卡片（标题为唯一随机标签，不会互相命中）。 */
function cardByTitle(page: Page, title: string) {
  return dayCards(page).filter({ hasText: title });
}

/** `YYYY-MM-DD` 加减整天（UTC 毫秒算术，与页面 `daysBetween` 同口径）。 */
function shiftDate(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Dashboard 底部「我的日子」小组件（按区块标题定位，避免与其它 section 混淆）。 */
function daysWidget(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "我的日子" }) });
}

/** 打开新建弹窗并填写公历日期后保存。 */
async function createSolarDay(
  page: Page,
  input: { title: string; date: string },
): Promise<void> {
  await page.getByTestId("days-create-button").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("记录一个日子")).toBeVisible();

  await dialog.getByTestId("day-form-title").fill(input.title);
  await dialog.getByTestId("day-form-date").fill(input.date);
  await dialog.getByTestId("day-form-submit").click();

  await expect(dialog).toBeHidden();
  await expect(cardByTitle(page, input.title)).toBeVisible();
}

/** 打开新建弹窗，切到农历并选月 / 日，保存。 */
async function createLunarDay(
  page: Page,
  input: { title: string; month: number; day: number },
): Promise<void> {
  await page.getByTestId("days-create-button").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("day-form-title").fill(input.title);
  await dialog.getByTestId("day-form-type-lunar").click();

  // 农历月 / 日是两个 shadcn Select；选项渲染在 portal 中，按 role=option 选。
  await dialog.getByTestId("day-form-month").click();
  await page
    .getByRole("option", { name: String(input.month), exact: true })
    .click();
  await dialog.getByTestId("day-form-day").click();
  await page
    .getByRole("option", { name: String(input.day), exact: true })
    .click();

  // 农历日子每年自动滚动：重复复选框锁定勾选，不可取消。
  const repeat = dialog.getByTestId("day-form-repeat");
  await expect(repeat).toBeChecked();
  await expect(repeat).toBeDisabled();
  await expect(dialog.getByText("农历日子每年自动滚动")).toBeVisible();

  await dialog.getByTestId("day-form-submit").click();

  await expect(dialog).toBeHidden();
  await expect(cardByTitle(page, input.title)).toBeVisible();
}

test.describe("flow 16: 个人空间重要日子", () => {
  test("空态入口 → 公历 / 农历新建 → 置顶 → 编辑 → 删除", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_days");
    const solarTitle = uniqueLabel("E2E days countdown");
    const lunarTitle = uniqueLabel("E2E days lunar birthday");
    const renamedTitle = uniqueLabel("E2E days renamed");
    const today = shanghaiToday();
    // 未来 30 天：方向恒为 upcoming，日期行可直接断言锚点。
    const solarDate = shiftDate(today, 30);

    await registerUser(page, username);

    // ① Dashboard 空态：小组件标题 + 空文案 +「去记录第一天」入口；
    //    个人侧栏出现「重要日子」导航项。
    const widget = daysWidget(page);
    await expect(widget).toBeVisible();
    await expect(widget.getByText("还没有记录的日子")).toBeVisible();
    await expect(
      page.locator("aside").getByRole("link", {
        name: DAYS_NAV_LABEL,
        exact: true,
      }),
    ).toBeVisible();

    // 经空态入口进入模块页。
    await widget.getByRole("link", { name: "去记录第一天" }).click();
    await expect(page).toHaveURL(/\/space\/personal\/days$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: DAYS_NAV_LABEL, level: 1 }),
    ).toBeVisible();

    // ② 新建公历倒计时：卡片显示锚点日期与倒计时文案（不钉死具体天数）。
    await createSolarDay(page, { title: solarTitle, date: solarDate });

    const solarCard = cardByTitle(page, solarTitle);
    await expect(solarCard.getByText(solarDate, { exact: true })).toBeVisible();
    await expect(solarCard.getByText(/还有 [\d,]+ 天/)).toBeVisible();
    // 未勾选「每年重复」：公历卡片不应出现「每年」徽标。
    await expect(solarCard.getByText("每年", { exact: true })).toHaveCount(0);

    // 回 Dashboard：小组件出现该条目与倒计时文案。
    await page.goto("/space/personal/dashboard");
    const filledWidget = daysWidget(page);
    await expect(filledWidget.getByText(solarTitle, { exact: true })).toBeVisible();
    await expect(filledWidget.getByText(/还有 [\d,]+ 天/)).toBeVisible();

    // 经小组件「查看全部」回到模块页（另一条入口）。
    await filledWidget.getByRole("link", { name: "查看全部" }).click();
    await expect(page).toHaveURL(/\/space\/personal\/days$/, {
      timeout: 30_000,
    });

    // ③ 新建农历生日：卡片带「农历」+「每年」徽标，日期行为换算后的公历日。
    await createLunarDay(page, { title: lunarTitle, month: 8, day: 15 });

    const lunarCard = cardByTitle(page, lunarTitle);
    await expect(lunarCard.getByText("农历", { exact: true })).toBeVisible();
    await expect(lunarCard.getByText("每年", { exact: true })).toBeVisible();
    await expect(
      lunarCard.getByText(/^\d{4}-\d{2}-\d{2}$/),
    ).toBeVisible();
    await expect(lunarCard.getByText(/还有 [\d,]+ 天/)).toBeVisible();

    // ④ 置顶：取当前排序第二的卡片置顶，它应升到第一位（服务端排序）。
    const orderBefore = await dayCards(page).locator("h2").allTextContents();
    expect(orderBefore).toHaveLength(2);
    const secondTitle = orderBefore[1]!;
    await cardByTitle(page, secondTitle)
      .getByRole("button", { name: `置顶 ${secondTitle}`, exact: true })
      .click();
    await expect(dayCards(page).first()).toContainText(secondTitle);
    // 置顶按钮切换为「取消置顶」，acknowledging aria-pressed 同步。
    await expect(
      cardByTitle(page, secondTitle).getByRole("button", {
        name: `取消置顶 ${secondTitle}`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");

    // ⑤ 编辑改名：弹窗回显当前名称，保存后卡片换新名、旧名消失。
    const editedTitle = secondTitle === solarTitle ? solarTitle : lunarTitle;
    await cardByTitle(page, editedTitle)
      .getByRole("button", { name: `编辑 ${editedTitle}`, exact: true })
      .click();

    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("编辑日子")).toBeVisible();
    await expect(editDialog.getByTestId("day-form-title")).toHaveValue(
      editedTitle,
    );
    await editDialog.getByTestId("day-form-title").fill(renamedTitle);
    await editDialog.getByTestId("day-form-submit").click();

    await expect(editDialog).toBeHidden();
    await expect(cardByTitle(page, renamedTitle)).toBeVisible();
    await expect(cardByTitle(page, editedTitle)).toHaveCount(0);

    // ⑥ 删除（ConfirmModal 二次确认）：确认后弹窗关闭、卡片消失。
    await cardByTitle(page, renamedTitle)
      .getByRole("button", { name: `删除 ${renamedTitle}`, exact: true })
      .click();

    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(`删除「${renamedTitle}」？`);
    await page.getByTestId("day-delete-confirm").click();

    await expect(confirmDialog).toBeHidden();
    await expect(cardByTitle(page, renamedTitle)).toHaveCount(0);

    // 删除最后一张卡片后回到模块页空态；刷新仍为空态（删除已持久化）。
    const remainingTitle = editedTitle === solarTitle ? lunarTitle : solarTitle;
    await cardByTitle(page, remainingTitle)
      .getByRole("button", { name: `删除 ${remainingTitle}`, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByTestId("day-delete-confirm").click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(dayCards(page)).toHaveCount(0);
    await expect(page.getByText("还没有记录的日子", { exact: true })).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: DAYS_NAV_LABEL, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("还没有记录的日子", { exact: true })).toBeVisible();
    await expect(dayCards(page)).toHaveCount(0);
  });
});
