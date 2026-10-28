import { expect, test } from "@playwright/test";

import { registerUser, uniqueLabel, uniqueUsername } from "../utils/flows";

/**
 * 关键流 5：所有者解散团队。
 *
 * 解散需要二次确认（输入团队名称）；成功后团队页 404、侧栏入口消失。
 */
test.describe("flow 5: 解散团队", () => {
  test("owner 二次确认后团队被删除", async ({ page }) => {
    const username = uniqueUsername("e2e_dis");
    const teamName = uniqueLabel("E2E dissolve");

    await registerUser(page, username);
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

    // 二次确认：先点「解散团队」，再在弹窗中输入团队名称并确认。
    await page.getByRole("button", { name: "解散团队", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("请输入团队名称以确认").fill(teamName);
    await dialog.getByRole("button", { name: "确认解散" }).click();

    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });

    // 团队页已不存在：HTTP 404 + 404 文案。
    const response = await page.goto(`/space/${teamSlug}/dashboard`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByText("抱歉，你访问的页面不存在。"),
    ).toBeVisible();

    // 侧栏不再出现该团队入口。v1.1 团队名只在空间切换器下拉里渲染，
    // 侧栏触发按钮始终显示「个人空间」，必须展开菜单验证才不是空断言。
    await page.goto("/space/personal/dashboard");
    await page
      .locator("aside")
      .getByRole("button", { name: /个人空间/ })
      .click();
    await expect(page.getByRole("menuitem", { name: teamName })).toHaveCount(0);
  });
});
