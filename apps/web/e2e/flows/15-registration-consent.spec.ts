import { expect, test } from "@playwright/test";

import zhMessages from "../../src/i18n/messages/zh.json";
import { E2E_PASSWORD, E2E_REGISTRATION_CODE, uniqueUsername } from "../utils/flows";
import { TEST_IDS } from "../utils/testids";

/**
 * 关键流 15：注册同意门槛与法律文档页。
 *
 * 覆盖：
 * 1. 未勾选《隐私政策》《用户协议》提交 → 前端拦截，仍留在注册页并出现
 *    agreeRequired 错误文案（文案取自消息包，不硬编码）；
 * 2. 勾选后注册成功 → 进入个人空间 Dashboard；
 * 3. 匿名访问 /legal/privacy 与 /legal/terms 可达（不被重定向到 /login），
 *    版本号与 AGREEMENT_VERSION 一致（"2026-11-v1"）。
 *
 * 断言一律走 data-testid / role；zh 文案取自消息包（zh.json），不硬编码。
 */
test.describe("flow 15: 注册同意门槛与法律文档页", () => {
  test("未勾选条款提交被拦，勾选后注册成功", async ({ page }) => {
    const username = uniqueUsername("e2e_tos");

    await page.goto("/register");
    await page.getByTestId(TEST_IDS.auth.usernameInput).fill(username);
    await page.getByTestId(TEST_IDS.auth.emailInput).fill(`${username}@e2e.local`);
    await page.getByTestId(TEST_IDS.auth.passwordInput).fill(E2E_PASSWORD);
    await page.getByTestId(TEST_IDS.auth.passwordConfirmInput).fill(E2E_PASSWORD);
    await page.getByTestId(TEST_IDS.auth.registrationCodeInput).fill(E2E_REGISTRATION_CODE);

    // 不勾选直接提交：前端 zod 拦截（服务端同样校验，见单元测试）。
    await page.getByTestId(TEST_IDS.auth.submitButton).click();

    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByTestId("auth-agree-tos-error")).toHaveText(
      zhMessages.auth.agreeRequired,
    );

    // 勾选后提交成功：进入个人空间 Dashboard。
    await page.getByTestId(TEST_IDS.auth.agreeCheckbox).click();
    await page.getByTestId(TEST_IDS.auth.submitButton).click();

    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, { timeout: 30_000 });
  });

  test("法律文档页匿名可达且显示条款版本", async ({ page }) => {
    for (const [path, titleKey] of [
      ["/legal/privacy", "privacy"],
      ["/legal/terms", "terms"],
    ] as const) {
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        zhMessages.legal[titleKey].title,
      );
      // 版本行由服务端 AGREEMENT_VERSION 常量渲染，与勾选留痕的版本一致。
      await expect(page.getByText("2026-11-v1")).toBeVisible();
    }
  });
});
