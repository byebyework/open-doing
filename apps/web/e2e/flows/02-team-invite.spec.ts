import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import { registerUser, uniqueLabel, uniqueUsername } from "../utils/flows";

/**
 * 关键流 2：A 注册建团队并通过 UID 邀请 B → B 注册接受邀请 → B 可见团队。
 *
 * B 使用独立 BrowserContext（独立 cookie），A 与 B 的会话互不覆盖。
 * UID 从 B 自己的「待处理邀请」页读取，不查询数据库。
 */
test.describe("flow 2: 团队邀请", () => {
  test("A 邀请 B，B 接受后可见团队", async ({ page, browser }) => {
    const ownerName = uniqueUsername("e2e_own");
    const guestName = uniqueUsername("e2e_gst");
    const teamName = uniqueLabel("E2E team");

    // A：注册并创建团队，落在团队设置页。
    await registerUser(page, ownerName);

    // 旧 URL 重定向：/my → /space/personal/dashboard（307）。
    await page.goto("/my");
    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });

    // /teams/new 不是团队 slug，仍由自己的静态页承接（不应被重定向）。
    const newTeamResponse = await page.goto("/teams/new");
    expect(newTeamResponse?.status()).toBe(200);
    await expect(
      page.getByTestId(TEST_IDS.teams.createTeamHeading),
    ).toBeVisible();

    await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
    await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    const teamSlug = decodeURIComponent(
      new URL(page.url()).pathname.split("/")[2] ?? "",
    );
    expect(teamSlug).not.toBe("");

    // 旧团队 URL 重定向：/teams/{slug} → /space/{slug}/dashboard。
    await page.goto(`/teams/${teamSlug}`);
    await expect(page).toHaveURL(
      new RegExp(`/space/${teamSlug}/dashboard$`),
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();

    // 回到设置页继续发起邀请。
    await page.goto(`/space/${teamSlug}/settings`);

    // B：独立上下文注册，并读取自己的 UID。
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await registerUser(guestPage, guestName);
      await guestPage.goto("/invites");

      const uid = (
        await guestPage.getByTestId(TEST_IDS.teams.accountUid).innerText()
      ).trim();
      expect(uid).toMatch(/^doing_[a-z0-9]+$/);

      // A：输入 UID 后缀发起邀请。
      await page.getByTestId(TEST_IDS.teams.inviteUidInput).fill(uid.replace(/^doing_/, ""));
      await page.getByTestId(TEST_IDS.teams.inviteSendButton).click();

      // 「已发出 · 待处理（1）」为计数断言：标题由 testid 定位，数量是被测行为。
      await expect(
        page.getByTestId(TEST_IDS.teams.invitePendingHeading),
      ).toContainText("1");
      await expect(page.getByText(guestName, { exact: true })).toBeVisible();

      // B：刷新邀请页并接受。
      await guestPage.goto("/invites");
      await guestPage.getByTestId(TEST_IDS.teams.inviteAcceptButton).click();
      // 接受后邀请进入「已处理」分区，待处理分区变空：
      // 空态文案是被测行为（接受成功 → 待处理清零）。
      await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();

      // B：侧栏空间切换器出现团队，选中后进入团队 Dashboard。
      const switcher = guestPage
        .locator("aside")
        .getByTestId(TEST_IDS.shell.spaceSwitcherTrigger);
      await switcher.click();
      const teamItem = guestPage.getByRole("menuitem", { name: teamName });
      await expect(teamItem).toBeVisible();
      await teamItem.click();
      await expect(guestPage).toHaveURL(
        new RegExp(`/space/${teamSlug}/dashboard$`),
        { timeout: 30_000 },
      );
      await expect(
        guestPage.getByRole("heading", { name: "Dashboard", level: 1 }),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
});
