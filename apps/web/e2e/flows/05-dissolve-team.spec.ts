import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
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
    await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
    await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    const teamSlug = decodeURIComponent(
      new URL(page.url()).pathname.split("/")[2] ?? "",
    );
    expect(teamSlug).not.toBe("");

    // 二次确认：先点「解散团队」，再在弹窗中输入团队名称并确认。
    await page.getByTestId(TEST_IDS.teamDanger.dissolveTeamButton).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId(TEST_IDS.teamDanger.dissolveConfirmInput)
      .fill(teamName);
    await dialog.getByTestId(TEST_IDS.teamDanger.dissolveConfirmButton).click();

    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });

    // 团队页已不存在：HTTP 404 + 404 文案。
    const response = await page.goto(`/space/${teamSlug}/dashboard`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByTestId(TEST_IDS.misc.notFoundMessage),
    ).toBeVisible();

    // 侧栏不再出现该团队入口。v1.1 团队名只在空间切换器下拉里渲染，
    // 侧栏触发按钮始终显示「个人空间」，必须展开菜单验证才不是空断言。
    await page.goto("/space/personal/dashboard");
    await page
      .locator("aside")
      .getByTestId(TEST_IDS.shell.spaceSwitcherTrigger)
      .click();
    await expect(page.getByRole("menuitem", { name: teamName })).toHaveCount(0);
  });

  test("确认名称不符时弹窗保持打开且输入保留", async ({ page }) => {
    const username = uniqueUsername("e2e_dismis");
    const teamName = uniqueLabel("E2E keep modal");

    await registerUser(page, username);
    await page.goto("/teams/new");
    await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
    await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    await page.getByTestId(TEST_IDS.teamDanger.dissolveTeamButton).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 名称不符 → toast 报错；弹窗必须保持打开且输入不丢（antd confirm 语义）。
    const wrongName = uniqueLabel("Wrong name");
    await dialog
      .getByTestId(TEST_IDS.teamDanger.dissolveConfirmInput)
      .fill(wrongName);
    await dialog.getByTestId(TEST_IDS.teamDanger.dissolveConfirmButton).click();

    await expect(page.locator("[data-sonner-toast]")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByTestId(TEST_IDS.teamDanger.dissolveConfirmInput),
    ).toHaveValue(wrongName);
  });
});
