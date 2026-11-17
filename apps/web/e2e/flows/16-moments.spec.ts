import { expect, test, type Page } from "@playwright/test";

import {
  registerUser,
  shanghaiToday,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";
import { TEST_IDS } from "../utils/testids";

/**
 * 关键流 16：个人空间「时刻」模块（v2 重构）。
 *
 * 覆盖：
 * 1. 新用户个人 Dashboard「时刻 · 置顶速览」空态（空态入口直达模块页）；
 *    个人侧栏出现「时刻」入口；
 * 2. 模块页新建正计时（过去起始日）：卡片显示「已经 N 天」与「正计时」徽标；
 * 3. 新建倒计时（今天 +30 天）：卡片显示「还有 N 天」与「倒计时」徽标；
 * 4. 新建周期（每周、目标星期 = 明天）：卡片显示「每周X · 循环」徽标，
 *    方向恒为 upcoming（明天 = 还有 1 天）；
 * 5. 回 Dashboard：速览 pills 出现三条时刻，倒计时 / 正计时文案形态正确，
 *    点击 pill 跳回模块页（pill 是模块页链接）；
 * 6. 置顶：取消置顶后卡片落到列表末位、图钉 aria-pressed=false；再置顶复原；
 * 7. 编辑改名：弹窗回显当前名称，保存后旧名消失、新名出现；
 * 8. 删除（ConfirmModal 二次确认）：弹窗关闭、卡片消失；
 * 9. 团队空间侧栏不含「时刻」入口（个人空间专属；flow 11 亦覆盖）。
 *
 * 日期一律以 `shanghaiToday()`（与页面 `todayInShanghai()` 同口径）派生，
 * 天数只断言稳定文案形态 / 已知固定偏移（每周目标取「明天」恒为 1 天），
 * 不钉死与当前日期耦合的绝对数字——用例可在任意日期运行。
 */

test.describe.configure({ timeout: 120_000 });

/** 个人侧栏 / 模块页标题 / 速览小节的「时刻」文案（zh 消息包）。 */
const MOMENTS_LABEL = "时刻";
const WIDGET_TITLE = "时刻 · 置顶速览";

/** 星期标签（zh 消息包 `date.weekday*` 的取值，索引 0=周日 … 6=周六）。 */
const WEEKDAY_LABELS = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
] as const;

/** 模块页卡片墙的全部卡片（`data-testid` 由组件侧硬编码为 `moment-card-<id>`）。 */
function momentCards(page: Page) {
  return page.locator(
    `article[data-testid^="${TEST_IDS.moments.cardPrefix}"]`,
  );
}

/** 按卡片标题定位单张卡片（标题为唯一随机标签，不会互相命中）。 */
function cardByTitle(page: Page, title: string) {
  return momentCards(page).filter({ hasText: title });
}

/** Dashboard 的「时刻 · 置顶速览」小节（按小节标题定位，避免与其它 section 混淆）。 */
function momentsWidget(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: WIDGET_TITLE }) });
}

/** `YYYY-MM-DD` 加减整天（UTC 毫秒算术，与页面 `daysBetween` 同口径）。 */
function shiftDate(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(
    Date.UTC(year!, month! - 1, day!) + offset * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

/** 日历日对应的星期索引（0=周日 … 6=周六，与 `resolveOccurrence` 同口径）。 */
function weekdayIndex(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

/** 点「新建时刻」并返回已打开的弹窗。 */
async function openCreateDialog(page: Page) {
  await page.getByTestId(TEST_IDS.moments.createButton).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("flow 16: 个人空间时刻", () => {
  test("空态入口 → 三种模式新建 → 速览跳转 → 置顶 → 编辑 → 删除", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_mom");
    const upTitle = uniqueLabel("E2E moment count up");
    const downTitle = uniqueLabel("E2E moment countdown");
    const weeklyTitle = uniqueLabel("E2E moment weekly");
    const renamedTitle = uniqueLabel("E2E moment renamed");
    const today = shanghaiToday();
    // 过去 100 天：正计时恒为 elapsed；未来 30 天：倒计时恒为 upcoming。
    const upDate = shiftDate(today, -100);
    const downDate = shiftDate(today, 30);
    // 周期目标取「明天」的星期：无论今天星期几，下一次发生日都是明天（1 天）。
    const weeklyWeekday = weekdayIndex(shiftDate(today, 1));

    await registerUser(page, username);

    // ① Dashboard 空态：速览标题 + 空文案 +「去记录第一个时刻」入口；
    //    个人侧栏出现「时刻」导航项。
    const emptyWidget = momentsWidget(page);
    await expect(emptyWidget).toBeVisible();
    await expect(
      emptyWidget.getByText("还没有记录的时刻", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("aside").getByRole("link", {
        name: MOMENTS_LABEL,
        exact: true,
      }),
    ).toBeVisible();

    // 经空态入口进入模块页。
    await emptyWidget.getByRole("link", { name: "去记录第一个时刻" }).click();
    await expect(page).toHaveURL(/\/space\/personal\/moments$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: MOMENTS_LABEL, level: 1 }),
    ).toBeVisible();

    // ② 新建正计时（过去起始日）：卡片「正计时」徽标 +「已经 N 天」。
    const upDialog = await openCreateDialog(page);
    await upDialog.getByTestId(TEST_IDS.moments.formTitle).fill(upTitle);
    await upDialog.getByTestId(TEST_IDS.moments.formModeUp).click();
    await expect(
      upDialog.getByTestId(TEST_IDS.moments.formModeUp),
    ).toHaveAttribute("aria-pressed", "true");
    await upDialog.getByTestId(TEST_IDS.moments.formDate).fill(upDate);
    await upDialog.getByTestId(TEST_IDS.moments.formSubmit).click();
    await expect(upDialog).toBeHidden();

    const upCard = cardByTitle(page, upTitle);
    await expect(upCard).toBeVisible();
    await expect(upCard.getByText("正计时", { exact: true })).toBeVisible();
    await expect(upCard.getByText(/已经\s*[\d,]+\s*天/)).toBeVisible();

    // ③ 新建倒计时（未来 30 天）：卡片「倒计时」徽标 +「还有 N 天」。
    const downDialog = await openCreateDialog(page);
    await downDialog.getByTestId(TEST_IDS.moments.formTitle).fill(downTitle);
    await downDialog.getByTestId(TEST_IDS.moments.formModeDown).click();
    await expect(
      downDialog.getByTestId(TEST_IDS.moments.formModeDown),
    ).toHaveAttribute("aria-pressed", "true");
    await downDialog.getByTestId(TEST_IDS.moments.formDate).fill(downDate);
    await downDialog.getByTestId(TEST_IDS.moments.formSubmit).click();
    await expect(downDialog).toBeHidden();

    const downCard = cardByTitle(page, downTitle);
    await expect(downCard).toBeVisible();
    await expect(downCard.getByText("倒计时", { exact: true })).toBeVisible();
    await expect(downCard.getByText(/还有\s*[\d,]+\s*天/)).toBeVisible();

    // ④ 新建周期（每周、目标星期取明天）：徽标「每周X · 循环」+ 还有 1 天。
    const weeklyDialog = await openCreateDialog(page);
    await weeklyDialog.getByTestId(TEST_IDS.moments.formTitle).fill(weeklyTitle);
    await weeklyDialog.getByTestId(TEST_IDS.moments.formModePeriodic).click();
    await expect(
      weeklyDialog.getByTestId(TEST_IDS.moments.formModePeriodic),
    ).toHaveAttribute("aria-pressed", "true");
    await weeklyDialog.getByTestId(TEST_IDS.moments.formCycleWeekly).click();
    await expect(
      weeklyDialog.getByTestId(TEST_IDS.moments.formCycleWeekly),
    ).toHaveAttribute("aria-pressed", "true");

    // 周几是 shadcn Select：选项渲染在 portal 中，按 role=option 定位。
    await weeklyDialog.getByTestId(TEST_IDS.moments.formWeekday).click();
    await page
      .getByRole("option", {
        name: WEEKDAY_LABELS[weeklyWeekday]!,
        exact: true,
      })
      .click();

    await weeklyDialog.getByTestId(TEST_IDS.moments.formSubmit).click();
    await expect(weeklyDialog).toBeHidden();

    const weeklyCard = cardByTitle(page, weeklyTitle);
    await expect(weeklyCard).toBeVisible();
    await expect(weeklyCard.getByText(/每周. · 循环/)).toBeVisible();
    await expect(weeklyCard.getByText(/还有\s*1\s*天/)).toBeVisible();

    // 三条新建均走「保存并置顶」：卡片都带置顶徽标。
    for (const title of [upTitle, downTitle, weeklyTitle]) {
      await expect(cardByTitle(page, title).getByText("置顶", { exact: true }))
        .toBeVisible();
    }

    // ⑤ 回 Dashboard：速览 pills 出现三条时刻，文案形态正确；pill 点击回模块页。
    await page.goto("/space/personal/dashboard");
    const filledWidget = momentsWidget(page);
    await expect(filledWidget).toBeVisible();
    for (const title of [upTitle, downTitle, weeklyTitle]) {
      await expect(
        filledWidget.getByText(title, { exact: true }),
      ).toBeVisible();
    }
    await expect(
      filledWidget.locator("a").filter({ hasText: upTitle }).getByText(
        /已经\s*[\d,]+\s*天/,
      ),
    ).toBeVisible();
    await expect(
      filledWidget.locator("a").filter({ hasText: downTitle }).getByText(
        /还有\s*[\d,]+\s*天/,
      ),
    ).toBeVisible();
    await expect(
      filledWidget.getByRole("link", { name: "管理全部" }),
    ).toBeVisible();

    await filledWidget
      .locator("a")
      .filter({ hasText: weeklyTitle })
      .click();
    await expect(page).toHaveURL(/\/space\/personal\/moments$/, {
      timeout: 30_000,
    });

    // ⑥ 置顶 / 取消置顶：全置顶时排序为 [每周(1天), 倒计时(30天), 正计时(elapsed)]；
    //    取消倒计时的置顶后它落到列表末位，图钉 aria-pressed 同步为 false。
    await expect(momentCards(page)).toHaveCount(3);
    await expect(momentCards(page).nth(0)).toContainText(weeklyTitle);
    await expect(momentCards(page).nth(1)).toContainText(downTitle);

    await cardByTitle(page, downTitle)
      .getByRole("button", { name: "取消置顶", exact: true })
      .click();

    // 文案与 aria-pressed 由服务端刷新后的 props 驱动：按钮切换为「置顶」。
    await expect(
      cardByTitle(page, downTitle).getByRole("button", {
        name: "置顶",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(momentCards(page).last()).toContainText(downTitle);

    // 再置顶复原到倒计时在前的排序。
    await cardByTitle(page, downTitle)
      .getByRole("button", { name: "置顶", exact: true })
      .click();
    await expect(
      cardByTitle(page, downTitle).getByRole("button", {
        name: "取消置顶",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(momentCards(page).nth(1)).toContainText(downTitle);

    // ⑦ 编辑改名：弹窗回显当前名称，保存后卡片换新名、旧名消失。
    await cardByTitle(page, downTitle)
      .getByRole("button", { name: `编辑 ${downTitle}`, exact: true })
      .click();

    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("编辑时刻", { exact: true })).toBeVisible();
    await expect(
      editDialog.getByTestId(TEST_IDS.moments.formTitle),
    ).toHaveValue(downTitle);
    await editDialog.getByTestId(TEST_IDS.moments.formTitle).fill(renamedTitle);
    await editDialog.getByTestId(TEST_IDS.moments.formSubmit).click();

    await expect(editDialog).toBeHidden();
    await expect(cardByTitle(page, renamedTitle)).toBeVisible();
    await expect(cardByTitle(page, downTitle)).toHaveCount(0);

    // ⑧ 删除（ConfirmModal 二次确认）：确认后弹窗关闭、卡片消失。
    await cardByTitle(page, renamedTitle)
      .getByRole("button", { name: `删除 ${renamedTitle}`, exact: true })
      .click();

    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(`删除「${renamedTitle}」？`);
    await page.getByTestId(TEST_IDS.moments.deleteConfirm).click();

    await expect(confirmDialog).toBeHidden();
    await expect(cardByTitle(page, renamedTitle)).toHaveCount(0);
    await expect(momentCards(page)).toHaveCount(2);
  });

  test("团队空间侧栏不含「时刻」入口（个人空间专属）", async ({ page }) => {
    const username = uniqueUsername("e2e_mt");
    const teamName = uniqueLabel("E2E moments team");

    await registerUser(page, username);

    // 建团后落在团队设置页：团队侧栏 6 模块以「团队管理」收尾，不含「时刻」。
    await page.goto("/teams/new");
    await page.getByLabel("团队名称").fill(teamName);
    await page.getByRole("button", { name: "创建团队" }).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    await expect(
      page.locator("aside").getByRole("link", {
        name: "团队管理",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator("aside").getByRole("link", {
        name: MOMENTS_LABEL,
        exact: true,
      }),
    ).toHaveCount(0);
  });
});
