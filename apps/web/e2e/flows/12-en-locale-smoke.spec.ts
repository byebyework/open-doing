import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from "../utils/env";
import { TEST_IDS } from "../utils/testids";
import { registerUser, uniqueUsername } from "../utils/flows";

/**
 * 关键流 12：英文界面冒烟（i18n 验收）。
 *
 * 覆盖（对照 i18n 计划 Task 20）：
 * 1. 设置页把界面语言切到 English → Dashboard / 看板 / 日历出现英文文案；
 * 2. 刷新后仍是英文（cookie 持久化），`html lang="en-US"`；
 * 3. antd 日期组件（月历表头）随 locale 切到英文；
 * 4. 整个过程无 hydration error；
 * 5. 数据库 `users.language = 'en'`；
 * 6. 切回「简体中文」的路径可用（界面恢复中文）。
 *
 * 与其它流一致走真实 UI：e2e 库由 global-setup 清空且不跑 seed，没有种子
 * 用户，因此注册全新账号后从设置页切语言（种子用户在 i18n 冒烟里的唯一
 * 价值是「已有账号切语言」，与本流等价）。
 */
test.describe("flow 12: 英文界面冒烟", () => {
  test("切英文后全站英文、持久化、无 hydration error，可切回中文", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_en");

    // 收集 hydration / 运行时错误：从页面创建起挂监听。
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await registerUser(page, username);

    // ===== 设置页切英文 =====
    await page.goto("/space/personal/settings");
    await page.getByTestId(TEST_IDS.settings.languageSelect).click();
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "English" })
      .click();

    // 成功 toast（文案是被测行为）+ RSC 以英文重渲染。
    await expect(page.getByText("Language updated")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();

    // ===== Dashboard 英文关键文案 =====
    await page.goto("/space/personal/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Due today / tomorrow", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Overdue", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Personal space", { exact: true }).first(),
    ).toBeVisible();

    // ===== 看板英文列头 =====
    await page.goto("/space/personal/kanban");
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.spaceColumnTodo)
        .getByText("To do", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.spaceColumnInProgress)
        .getByText("In progress", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.spaceColumnDone)
        .getByText("Done", { exact: true }),
    ).toBeVisible();

    // ===== html lang + antd 日期组件英文 =====
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await page.goto("/space/personal/calendar");
    // antd Calendar（en_US）表头为英文短星期（Su / Sun 视版本），且不再出现中文星期。
    await expect(
      page
        .locator(".ant-picker-content th")
        .filter({ hasText: /^(Su|Sun)$/ })
        .first(),
    ).toBeVisible();
    await expect(
      page.locator(".ant-picker-content th").filter({ hasText: /^一$/ }),
    ).toHaveCount(0);

    // ===== 刷新后仍为英文（cookie 持久化） =====
    await page.reload(); // 仍在日历页，硬刷新验证 cookie 生效
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await page.goto("/space/personal/kanban");
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.spaceColumnTodo)
        .getByText("To do", { exact: true }),
    ).toBeVisible();

    // ===== 无 hydration / 运行时错误 =====
    const hydrationErrors = [...consoleErrors, ...pageErrors].filter(
      (text) =>
        /hydrat/i.test(text) ||
        /did not match/i.test(text) ||
        /Minified React error #(418|423|425)/.test(text),
    );
    expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    // antd 静态 message/modal 无法消费动态主题上下文（须走 App.useApp）。
    const staticContextWarnings = consoleErrors.filter((text) =>
      /Static function can not consume context/i.test(text),
    );
    expect(
      staticContextWarnings,
      staticContextWarnings.join("\n"),
    ).toEqual([]);

    // ===== users.language = 'en' =====
    assertE2EDatabaseUrl(E2E_DATABASE_URL);
    const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    let language: string | undefined;
    try {
      const rows = await client`
        SELECT language FROM users WHERE username = ${username} LIMIT 1
      `;
      expect(rows.length).toBe(1);
      language = rows[0]!.language;
    } finally {
      await client.end({ timeout: 5 });
    }
    expect(language).toBe("en");

    // ===== 切回简体中文 =====
    await page.goto("/space/personal/settings");
    await page.getByTestId(TEST_IDS.settings.languageSelect).click();
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "简体中文" })
      .click();
    await expect(
      page.getByRole("heading", { name: "设置", level: 1 }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
});
