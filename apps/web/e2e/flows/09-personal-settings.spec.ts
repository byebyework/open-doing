import { expect, test, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "../utils/env";
import { TEST_IDS } from "../utils/testids";
import {
  E2E_PASSWORD,
  createPersonalProject,
  createPersonalTask,
  loginUser,
  openPersonalProject,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 9：个人设置（v1.1 M6，现为系统级 `/settings`）。
 *
 * 覆盖（对照实现计划的 Task 6 / UX 调整 Task 7）：
 * 1. 顶栏用户菜单「个人设置」进入设置页，三个区块标题 + 两个提醒 Switch
 *    默认开启；旧路由 `/space/personal/settings` 已移除（直接访问 404）；
 * 2. 改密码全流程：旧密码错误落在字段错误；正确改密后 toast 且保持登录；
 *    登出后旧密码登录失败、新密码成功；
 * 3. 关闭「临期提醒」后刷新仍为关（持久化）；
 * 4. 个人项目按最近活动排序：先建者产生任务动态后置顶（Kanban 项目筛选
 *    下拉顺序即 `listPersonalProjects` 的返回顺序）。
 *
 * 每个用例自建新用户，不依赖 seed 用户（林夏），避免互相污染。
 */

test.describe.configure({ timeout: 120_000 });

/** 设置页三个区块标题（顺序即渲染顺序）。 */
const SECTION_TITLES = ["账户安全", "任务提醒", "项目排序"] as const;

test.describe("flow 9: 个人空间设置", () => {
  test("用户菜单进入设置页，三区块与默认开启的开关", async ({ page }) => {
    await registerUser(page, uniqueUsername("e2e_st1"));

    // 个人设置入口在顶栏用户菜单（个人空间导航已不再渲染「设置」项）。
    await page.getByTestId(TEST_IDS.shell.userMenuButton).click();
    await page.getByTestId(TEST_IDS.shell.userMenuSettings).click();
    await expect(page).toHaveURL(/\/settings$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "设置", level: 1 }),
    ).toBeVisible();

    for (const title of SECTION_TITLES) {
      await expect(
        page.getByRole("heading", { name: title, level: 2 }),
      ).toBeVisible();
    }

    // 两个提醒开关默认全开（迁移列 DEFAULT true）。
    await expect(
      page.getByTestId(TEST_IDS.settings.dueSoonSwitch),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByTestId(TEST_IDS.settings.overdueSwitch),
    ).toHaveAttribute("aria-checked", "true");

    // 旧路由直接移除（需求方指定，不做重定向）：访问即 404。
    const oldRouteResponse = await page.goto("/space/personal/settings");
    expect(oldRouteResponse?.status()).toBe(404);
  });

  test("改密码：旧密码错误提示、成功 toast、登出后新密码生效", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_st2");
    const newPassword = "e2e-new-password-456";

    await registerUser(page, username);
    await page.goto("/settings");

    const oldPasswordInput = page.getByTestId(TEST_IDS.settings.oldPasswordInput);
    const newPasswordInput = page.getByTestId(TEST_IDS.settings.newPasswordInput);
    const confirmPasswordInput = page.getByTestId(
      TEST_IDS.settings.confirmPasswordInput,
    );

    // ① 旧密码错误：错误落在旧密码 Form.Item 内，不落表单级 alert。
    await oldPasswordInput.fill("definitely-wrong-password");
    await newPasswordInput.fill(newPassword);
    await confirmPasswordInput.fill(newPassword);
    await page.getByTestId(TEST_IDS.settings.updatePasswordButton).click();

    // 字段级作用域断言（等价于旧 antd Form.Item 作用域）：shadcn 表单把
    // 字段错误渲染进 `#settings-old-password-error` 并以 aria-describedby
    // 绑定到旧密码输入框——错误即便落到 errors.form 也仍会不通过。
    await expect(oldPasswordInput).toHaveAttribute(
      "aria-describedby",
      "settings-old-password-error",
    );
    // 「旧密码不正确」是恒定错误文案本身，属被测行为。
    await expect(page.locator("#settings-old-password-error")).toHaveText(
      "旧密码不正确",
    );
    // 反向钉住：表单级错误 Alert 不应出现（destructive variant 才是错误）。
    await expect(
      page.locator('[data-slot="alert"].text-destructive'),
    ).toHaveCount(0);

    // ② 旧密码正确：toast「密码已更新」，且保持登录。
    await oldPasswordInput.fill(E2E_PASSWORD);
    await page.getByTestId(TEST_IDS.settings.updatePasswordButton).click();
    await expect(page.getByText("密码已更新")).toBeVisible();

    // better-auth 的 changePassword(revokeOtherSessions) 会删掉全部旧会话
    // （含当前会话）并签发新会话 cookie；Server Action 的 RSC 重渲染仍带旧
    // cookie，requireUser 先跳 /login，随后 (auth) 布局识别已登录用户再跳
    // 个人 Dashboard。用户始终处于登录态，只是回到 Dashboard 而非设置页。
    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "仪表盘", level: 1 }),
    ).toBeVisible();

    // ③ 登出（顶栏用户菜单）。
    await page.getByTestId(TEST_IDS.shell.userMenuButton).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    // ④ 旧密码登录失败：恒定文案「用户名或密码错误」（表单级 alert）。
    await page.getByTestId(TEST_IDS.auth.usernameInput).fill(username);
    await page.getByTestId(TEST_IDS.auth.passwordInput).fill(E2E_PASSWORD);
    await page.getByTestId(TEST_IDS.auth.submitButton).click();
    await expect(page.getByText("用户名或密码错误")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // ⑤ 新密码登录成功。
    await page.getByTestId(TEST_IDS.auth.passwordInput).fill(newPassword);
    await page.getByTestId(TEST_IDS.auth.submitButton).click();
    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });
  });

  test("改密后其它会话失效，当前会话保持登录", async ({ page, browser }) => {
    const username = uniqueUsername("e2e_st2b");
    const newPassword = "e2e-new-password-789";

    await registerUser(page, username);

    // 第二个浏览器上下文用同一账号登录，模拟另一台设备上的旧会话。
    const otherContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    const otherPage = await otherContext.newPage();
    await loginUser(otherPage, username);

    await page.goto("/settings");
    await page.getByTestId(TEST_IDS.settings.oldPasswordInput).fill(E2E_PASSWORD);
    await page.getByTestId(TEST_IDS.settings.newPasswordInput).fill(newPassword);
    await page
      .getByTestId(TEST_IDS.settings.confirmPasswordInput)
      .fill(newPassword);
    await page.getByTestId(TEST_IDS.settings.updatePasswordButton).click();
    await expect(page.getByText("密码已更新")).toBeVisible();

    // better-auth changePassword 以 revokeOtherSessions 撤销其它会话：
    // 旧设备再访问受保护页面会被 requireUser 重定向到登录页。
    await otherPage.goto("/space/personal/dashboard");
    await expect(otherPage).toHaveURL(/\/login$/, { timeout: 30_000 });

    // 当前设备拿到新会话：经 /login 的已登录跳转后仍落在个人 Dashboard。
    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "仪表盘", level: 1 }),
    ).toBeVisible();

    await otherContext.close();
  });

  test("关闭临期提醒后刷新仍为关", async ({ page }) => {
    await registerUser(page, uniqueUsername("e2e_st3"));
    await page.goto("/settings");

    const dueSoonSwitch = page.getByTestId(TEST_IDS.settings.dueSoonSwitch);
    await expect(dueSoonSwitch).toHaveAttribute("aria-checked", "true");

    // 等 Server Action 的 POST 真正完成，避免刷新早于落库。
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/settings"),
    );
    await dueSoonSwitch.click();
    await saved;

    await expect(dueSoonSwitch).toHaveAttribute("aria-checked", "false");

    // 刷新后从 RSC 重新取数，仍是关闭状态（已持久化）。
    await page.reload();
    await expect(
      page.getByTestId(TEST_IDS.settings.dueSoonSwitch),
    ).toHaveAttribute("aria-checked", "false");
    // 另一个开关不受影响。
    await expect(
      page.getByTestId(TEST_IDS.settings.overdueSwitch),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("个人项目按最近活动排序：后加任务的项目置顶", async ({ page }) => {
    const projectA = uniqueLabel("E2E st proj A");
    const projectB = uniqueLabel("E2E st proj B");
    const taskA = uniqueLabel("E2E st task A");

    await registerUser(page, uniqueUsername("e2e_st4"));

    // 先建 A、后建 B：两者都没有任务时按 createdAt 降序，B 在前。
    await createPersonalProject(page, projectA);
    // created_at 是秒级 timestamp：两次建项目落在同一秒会让排序键打平、
    // 顺序不确定。隔开 1 秒以上，保证「B 在前」可断言。
    await page.waitForTimeout(1_100);
    await createPersonalProject(page, projectB);

    await page.goto("/space/personal/kanban");
    await expectProjectOrder(page, [projectB, projectA]);

    // 给先建的 A 产生任务动态 → A 的最近活动晚于 B 的创建时间。
    await openPersonalProject(page, projectA);
    await createPersonalTask(page, { title: taskA });

    // 刷新后顺序变化：A 置顶，证明排序消费的是「最近活动」而非创建时间。
    await page.goto("/space/personal/kanban");
    await expectProjectOrder(page, [projectA, projectB]);
  });
});

/**
 * 断言 Kanban 项目筛选下拉的选项顺序。
 *
 * 下拉的 options 即 `listPersonalProjects` 的返回顺序（「全部项目」固定第一项），
 * 因此无需专用 fixture 即可通过 UI 低成本验证排序。
 */
async function expectProjectOrder(
  page: Page,
  names: readonly string[],
): Promise<void> {
  const trigger = page.getByTestId(TEST_IDS.kanban.projectFilter);
  await trigger.click();

  // shadcn Select 的选项带 role="option"（迁移前 antd 虚拟列表无此 role，
  // 旧定位用 .ant-select-item-option）。
  const options = page.getByRole("option");
  await expect(options).toHaveCount(names.length + 1); // +「全部项目」
  await expect(options.nth(0)).toHaveText("全部项目");

  for (const [index, name] of names.entries()) {
    await expect(options.nth(index + 1)).toHaveText(name);
  }

  await page.keyboard.press("Escape");
}
