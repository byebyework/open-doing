import { expect, test } from "@playwright/test";

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
    await page.goto("/teams/new");
    await page.getByLabel("团队名称").fill(teamName);
    await page.getByRole("button", { name: "创建团队" }).click();
    await expect(page).toHaveURL(/\/teams\/[^/]+\/settings$/, {
      timeout: 30_000,
    });

    const teamSlug = decodeURIComponent(
      new URL(page.url()).pathname.split("/")[2] ?? "",
    );
    expect(teamSlug).not.toBe("");

    // B：独立上下文注册，并读取自己的 UID。
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await registerUser(guestPage, guestName);
      await guestPage.goto("/invites");

      const uidText = await guestPage
        .locator("span.font-mono", { hasText: /^doing_/ })
        .first()
        .innerText();
      const uid = uidText.trim();
      expect(uid).toMatch(/^doing_[a-z0-9]+$/);

      // A：输入 UID 后缀发起邀请。
      await page.getByLabel("对方 UID").fill(uid.replace(/^doing_/, ""));
      await page.getByRole("button", { name: "发送邀请" }).click();

      await expect(page.getByText("已发出 · 待处理（1）")).toBeVisible();
      await expect(page.getByText(guestName, { exact: true })).toBeVisible();

      // B：刷新邀请页并接受。
      await guestPage.goto("/invites");
      // antd 自动在两个汉字间插入空格（「接 受」）。
      await guestPage.getByRole("button", { name: /^接\s*受$/ }).click();
      await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();

      // B：侧栏出现团队，且可进入团队概览页。
      await expect(
        guestPage.locator("aside").getByRole("link", { name: teamName }),
      ).toBeVisible();
      await guestPage.goto(`/teams/${teamSlug}`);
      await expect(
        guestPage.getByRole("heading", { name: "团队概览", level: 1 }),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });
});
