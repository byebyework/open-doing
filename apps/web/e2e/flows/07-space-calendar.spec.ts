import { expect, test, type Page } from "@playwright/test";

import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  openPersonalTask,
  registerUser,
  shanghaiToday,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 7：空间级 Calendar（v1.1 M4，`/space/{spaceRef}/calendar`）。
 *
 * 覆盖（对照实现计划的 Task 5）：
 * 1. 个人日历渲染当月，任务 chip 落在正确的日期格；
 * 2. 侧栏「本周任务」叠加本周任务，done 划线保留原位；
 * 3. `?month=` 翻月、非法月份静默回当月、「今天」按钮回当月；
 * 4. 个人「N 项任务没有截止日期 →」入口可见并跳 Dashboard；
 * 5. 团队日历 chip 带负责人头像，未指派任务渲染「未指派」tag；
 * 6. 非成员访问团队日历 404。
 *
 * 日期一律以 `shanghaiToday()`（与页面 `todayInShanghai()` 同口径）为基准
 * 派生出相对日期，不在用例里散落 `Date.now()`，避免与服务端日期漂移。
 */

// 团队用例要建第二个账号（邀请 + 移除），比其它流多一个浏览器上下文。
test.describe.configure({ timeout: 120_000 });

test.describe("flow 7: 空间级 Calendar", () => {
  test("个人日历渲染当月且 chip 落在正确日期格", async ({ page }) => {
    const username = uniqueUsername("e2e_cal1");
    const projectName = uniqueLabel("E2E cal project");
    const taskTitle = uniqueLabel("E2E cal task");
    const today = shanghaiToday();

    await seedPersonalTask(page, {
      username,
      projectName,
      taskTitle,
      dueDate: today,
    });

    await page.goto("/space/personal/calendar");

    // 默认渲染当前月，固定 42 格（6 周）网格。
    await expect(
      page.getByText(monthHeading(today.slice(0, 7)), { exact: true }),
    ).toBeVisible();
    await expect(page.locator("td[title]")).toHaveCount(42);

    // chip 只在今天对应的日期格内，相邻日期格不出现。
    const todayCell = dayCell(page, today);
    await expect(todayCell.getByText(taskTitle, { exact: true })).toBeVisible();
    const nextDayCell = dayCell(page, shiftDate(today, 1));
    await expect(
      nextDayCell.getByText(taskTitle, { exact: true }),
    ).toHaveCount(0);
  });

  test("侧栏本周清单含 done 任务并保持划线", async ({ page }) => {
    const username = uniqueUsername("e2e_cal2");
    const projectName = uniqueLabel("E2E cal done project");
    const taskTitle = uniqueLabel("E2E cal done task");
    const today = shanghaiToday();

    await seedPersonalTask(page, {
      username,
      projectName,
      taskTitle,
      dueDate: today,
    });

    // 详情页把任务标记完成（个人任务恒有编辑权）。
    await openPersonalTask(page, taskTitle);
    await page.getByRole("button", { name: "标记为已完成" }).click();
    await expect(
      page.getByRole("button", { name: "标记为未完成" }),
    ).toBeVisible();

    await page.goto("/space/personal/calendar");

    const weekCard = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "本周任务" }) });
    await expect(
      weekCard.getByText(`今天 · ${weekdayLabel(today)} ${today.slice(5)}`),
    ).toBeVisible();

    // done 任务留在本周清单原位，标题划线 + 右侧「已完成」。
    const weekTask = weekCard.getByRole("link", {
      name: taskTitle,
      exact: true,
    });
    await expect(weekTask).toBeVisible();
    await expect(weekTask).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await expect(
      weekCard.getByText("已完成", { exact: true }),
    ).toBeVisible();
  });

  test("翻月到无任务月、非法月份回退与「今天」按钮", async ({ page }) => {
    const username = uniqueUsername("e2e_cal3");
    const projectName = uniqueLabel("E2E cal month project");
    const taskTitle = uniqueLabel("E2E cal month task");
    const today = shanghaiToday();
    const currentMonth = today.slice(0, 7);
    const taskMonth = shiftMonth(currentMonth, 1);
    const emptyMonth = shiftMonth(currentMonth, 3);
    const taskDate = `${taskMonth}-15`;

    await seedPersonalTask(page, {
      username,
      projectName,
      taskTitle,
      dueDate: taskDate,
    });

    // `?month=` 直接落到指定月份，任务落在 15 日的格子里。
    await page.goto(`/space/personal/calendar?month=${taskMonth}`);
    await expect(
      page.getByText(monthHeading(taskMonth), { exact: true }),
    ).toBeVisible();
    await expect(
      dayCell(page, taskDate).getByText(taskTitle, { exact: true }),
    ).toBeVisible();

    // 无任务月：网格清空；侧栏锚定「今天」（不随翻月），本周 / 本月均无任务。
    await page.goto(`/space/personal/calendar?month=${emptyMonth}`);
    await expect(
      page.getByText(monthHeading(emptyMonth), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(taskTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText("本周没有要截止的任务")).toBeVisible();
    await expect(
      page.getByText("本月暂无即将到期的任务"),
    ).toBeVisible();

    // 非法 `?month=xx` 静默回退当前月（不 500、不报错）。
    await page.goto("/space/personal/calendar?month=xx");
    await expect(
      page.getByText(monthHeading(currentMonth), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(taskTitle, { exact: true })).toHaveCount(0);

    // 「下个月」按当前月翻到任务月，chip 回来。
    await page.getByRole("button", { name: "下个月" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/space/personal/calendar\\?month=${taskMonth}$`),
    );
    await expect(
      page.getByText(monthHeading(taskMonth), { exact: true }),
    ).toBeVisible();
    await expect(
      dayCell(page, taskDate).getByText(taskTitle, { exact: true }),
    ).toBeVisible();

    // 「今天」按钮回到无参数的本月地址。
    await page.getByRole("button", { name: "今天", exact: true }).click();
    await expect(page).toHaveURL(/\/space\/personal\/calendar$/);
    await expect(
      page.getByText(monthHeading(currentMonth), { exact: true }),
    ).toBeVisible();
  });

  test("个人无截止日期入口可见并跳 Dashboard", async ({ page }) => {
    const username = uniqueUsername("e2e_cal4");
    const projectName = uniqueLabel("E2E cal nodue project");
    const taskTitle = uniqueLabel("E2E cal nodue task");

    // 新建一条无截止日期的任务：无 due_date 不进日历，只留计数入口。
    await seedPersonalTask(page, { username, projectName, taskTitle });

    await page.goto("/space/personal/calendar");

    const noDueLink = page.getByRole("link", {
      name: /1 项任务没有截止日期/,
    });
    await expect(noDueLink).toBeVisible();
    await expect(page.getByText("(在 Dashboard 查看)")).toBeVisible();

    await noDueLink.click();
    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/);
  });

  test("团队日历 chip 带负责人头像与未指派 tag", async ({
    page,
    browser,
  }) => {
    const ownerName = uniqueUsername("e2e_cal5o");
    const guestName = uniqueUsername("e2e_cal5g");
    const teamName = uniqueLabel("E2E cal team");
    const projectName = uniqueLabel("E2E cal team project");
    const ownerTask = uniqueLabel("E2E cal owner task");
    const unassignedTask = uniqueLabel("E2E cal unassigned task");
    const today = shanghaiToday();

    await registerUser(page, ownerName);

    await page.goto("/teams/new");
    await page.getByLabel("团队名称").fill(teamName);
    await page.getByRole("button", { name: "创建团队" }).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    const teamSlug = decodeURIComponent(
      new URL(page.url()).pathname.split("/")[2] ?? "",
    );
    expect(teamSlug).not.toBe("");

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      // 第二个用户接受邀请，成为可被指派的团队成员。
      await registerUser(guestPage, guestName);
      await guestPage.goto("/invites");
      const uid = (
        await guestPage
          .locator("span.font-mono", { hasText: /^doing_/ })
          .first()
          .innerText()
      ).trim();

      await page.getByLabel("对方 UID").fill(uid.replace(/^doing_/, ""));
      await page.getByRole("button", { name: "发送邀请" }).click();
      await expect(page.getByText("已发出 · 待处理（1）")).toBeVisible();

      await guestPage.goto("/invites");
      await guestPage.getByRole("button", { name: /^接\s*受$/ }).click();
      await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();

      // 新建团队项目，建两张同一天截止的任务：一张归 owner，一张归 guest。
      await page.goto(`/space/${teamSlug}/projects/new`);
      await page.getByLabel("项目名称").fill(projectName);
      await page.getByRole("button", { name: "创建项目" }).click();
      await expect(
        page.getByRole("heading", { name: projectName, level: 1 }),
      ).toBeVisible({ timeout: 30_000 });

      await createTeamTask(page, { title: ownerTask, dueDate: today });
      await createTeamTask(page, {
        title: unassignedTask,
        dueDate: today,
        assignee: guestName,
      });

      // 移除 guest：其负责的任务按既有语义置空为「未指派」。
      await page.goto(`/space/${teamSlug}/settings`);
      const guestRow = page.getByRole("row", { name: new RegExp(guestName) });
      await guestRow.getByRole("button", { name: "移除", exact: true }).click();

      const confirmDialog = page.getByRole("dialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog
        .getByRole("button", { name: /^移\s*除$/ })
        .click();
      await expect(page.getByText("已移除成员")).toBeVisible();
    } finally {
      await guestContext.close();
    }

    await page.goto(`/space/${teamSlug}/calendar`);

    const todayCell = dayCell(page, today);
    await expect(
      todayCell.getByText(ownerTask, { exact: true }),
    ).toBeVisible();
    // 有负责人：chip 前缀是带 aria-label 的头像（首字 + 定色盘底色）。
    await expect(
      todayCell.getByRole("img", { name: ownerName }),
    ).toBeVisible();
    // 成员被移除后任务保留，chip 渲染「未指派」描边 tag。
    await expect(
      todayCell.getByText(unassignedTask, { exact: true }),
    ).toBeVisible();
    await expect(
      todayCell.getByText("未指派", { exact: true }),
    ).toBeVisible();
    await expect(
      todayCell.getByRole("img", { name: guestName }),
    ).toHaveCount(0);
  });

  test("非成员访问团队日历返回 404", async ({ page, browser }) => {
    const ownerName = uniqueUsername("e2e_cal6o");
    const outsiderName = uniqueUsername("e2e_cal6x");
    const teamName = uniqueLabel("E2E cal private team");

    await registerUser(page, ownerName);
    await page.goto("/teams/new");
    await page.getByLabel("团队名称").fill(teamName);
    await page.getByRole("button", { name: "创建团队" }).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });
    const teamSlug = decodeURIComponent(
      new URL(page.url()).pathname.split("/")[2] ?? "",
    );
    expect(teamSlug).not.toBe("");

    // 未受邀的账号访问团队日历：404 页，不泄露团队存在性。
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();

    try {
      await registerUser(outsiderPage, outsiderName);
      const response = await outsiderPage.goto(
        `/space/${teamSlug}/calendar`,
      );
      expect(response?.status()).toBe(404);
      await expect(
        outsiderPage.getByText("抱歉，你访问的页面不存在。"),
      ).toBeVisible();
    } finally {
      await outsiderContext.close();
    }

    // 对照组：owner 能正常打开同一地址。
    await page.goto(`/space/${teamSlug}/calendar`);
    await expect(
      page.getByRole("heading", { name: "Calendar", level: 1 }),
    ).toBeVisible();
  });
});

/** 注册账号 → 建个人项目 → 建任务（可带 `YYYY-MM-DD` 截止日期）。 */
async function seedPersonalTask(
  page: Page,
  input: {
    username: string;
    projectName: string;
    taskTitle: string;
    dueDate?: string;
  },
): Promise<void> {
  await registerUser(page, input.username);
  await createPersonalProject(page, input.projectName);
  await openPersonalProject(page, input.projectName);
  await createPersonalTask(page, {
    title: input.taskTitle,
    dueDate: input.dueDate,
  });
}

/**
 * 在团队项目页新建任务（责任人默认当前用户；传入 `assignee` 时改选成员）。
 *
 * 与 flow 6 同款操作路径；额外填「截止日期」，让任务落进日历。
 */
async function createTeamTask(
  page: Page,
  input: { title: string; dueDate: string; assignee?: string },
): Promise<void> {
  await page
    .getByRole("button", { name: "＋ 新建任务", exact: true })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 等弹窗 afterOpenChange 的 resetFields 完成后再填写。
  await page.waitForTimeout(500);
  await dialog.getByLabel("标题").fill(input.title);
  await dialog.getByLabel("截止日期").fill(input.dueDate);

  if (input.assignee) {
    // antd Select 的可见选项没有 role="option"，点击可见选项项。
    await dialog.getByLabel("责任人").click();
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: input.assignee })
      .click();
  }

  await dialog.getByRole("button", { name: "创建任务" }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("link", { name: input.title, exact: true }),
  ).toBeVisible();
}

/** 月历日期格：antd 在 `td` 上写 `title="YYYY-MM-DD"`。 */
function dayCell(page: Page, date: string) {
  return page.locator(`td[title="${date}"]`);
}

/** 月历标题文案（组件内为 `${year} 年 ${month} 月`）。 */
function monthHeading(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);

  return `${year} 年 ${monthIndex} 月`;
}

/** `YYYY-MM-DD` 加减天数（UTC 毫秒算术，与 `lib/today` 同口径）。 */
function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year!, month! - 1, day!) + days * 86_400_000,
  );

  return formatUtcDate(shifted);
}

/** `YYYY-MM` 加减月份（跨年自然进位）。 */
function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, monthIndex! - 1 + delta, 1));

  return formatUtcDate(shifted).slice(0, 7);
}

/** `Date`（UTC 字段）→ `YYYY-MM-DD`。 */
function formatUtcDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** `YYYY-MM-DD` → 「周X」（与页面 `weekdayLabel` 同口径）。 */
function weekdayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();

  return labels[weekday]!;
}
