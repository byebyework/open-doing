import { expect, test, type Page } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import { registerUser, uniqueLabel, uniqueUsername } from "../utils/flows";

/**
 * 关键流 10：凭码申请 → 审批（拒绝 → 再申请 → 批准）→ 加入团队。
 *
 * 两个用例各自注册全新账号并建团，互不依赖；申请人（B）使用独立
 * BrowserContext（独立 cookie），与所有者（A）的会话互不覆盖。
 * 加入码只从团队设置页「凭码加入」区块读取，不查询数据库。
 */

/** 注册后从 /teams/new 建团，落在设置页并返回团队 slug。 */
async function createTeam(page: Page, teamName: string): Promise<string> {
  await page.goto("/teams/new");
  await expect(
    page.getByTestId(TEST_IDS.teams.createTeamHeading),
  ).toBeVisible();

  await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
  await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
  await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
    timeout: 30_000,
  });

  const slug = decodeURIComponent(
    new URL(page.url()).pathname.split("/")[2] ?? "",
  );
  expect(slug).not.toBe("");
  return slug;
}

/** 从「凭码加入」区块读取 8 位加入码（复制按钮不影响文本内容）。 */
async function readJoinCode(page: Page): Promise<string> {
  const code = (
    await page.getByTestId(TEST_IDS.teams.joinCodeValue).innerText()
  ).trim();
  expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  return code;
}

/** 经 SpaceSwitcher 菜单的「凭码加入」进入申请页。 */
async function openJoinPageFromSwitcher(page: Page): Promise<void> {
  await page
    .locator("aside")
    .getByTestId(TEST_IDS.shell.spaceSwitcherTrigger)
    .click();
  await page.getByRole("menuitem", { name: "凭码加入" }).click();
  await expect(page).toHaveURL(/\/teams\/join$/, { timeout: 30_000 });
}

/** 填写加入码并提交申请。 */
async function submitJoinCode(page: Page, code: string): Promise<void> {
  await page.getByTestId(TEST_IDS.teams.joinCodeInput).fill(code);
  await page.getByTestId(TEST_IDS.teams.joinSubmitButton).click();
}

test.describe("flow 10: 凭码加入团队", () => {
  test("A 建团，B 凭码申请被拒后再次申请并通过", async ({
    page,
    browser,
  }) => {
    const ownerName = uniqueUsername("e2e_own");
    const guestName = uniqueUsername("e2e_gst");
    const teamName = uniqueLabel("E2E join team");

    // A：注册并建团（默认开启凭码加入，开关为开）。
    await registerUser(page, ownerName);
    const teamSlug = await createTeam(page, teamName);

    const code = await readJoinCode(page);
    await expect(
      page.getByTestId(TEST_IDS.teams.joinCodeSwitch),
    ).toBeChecked();
    // 开关状态说明文案是被测行为（默认开启凭码加入）。
    await expect(page.getByText("已开启：成员可凭码申请加入")).toBeVisible();

    // B：独立上下文注册。
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await registerUser(guestPage, guestName);

      // B：经 SpaceSwitcher 的「凭码加入」进入申请页，页尾互链文案可见。
      await openJoinPageFromSwitcher(guestPage);
      await expect(
        guestPage.getByRole("heading", { name: "凭码加入团队", level: 1 }),
      ).toBeVisible();
      await expect(
        guestPage.getByText(
          /不知道加入码？向团队管理员索取，或\s*创建自己的团队/,
        ),
      ).toBeVisible();

      // B：填码提交 → toast。
      await submitJoinCode(guestPage, code);
      await expect(
        guestPage.getByText("申请已提交，等待管理员审批"),
      ).toBeVisible();

      // B：/invites 的「我的加入申请（1）」待审批卡片可见。
      await guestPage.goto("/invites");
      await expect(
        guestPage.getByRole("heading", { name: "我的加入申请（1）" }),
      ).toBeVisible();
      await expect(
        guestPage.getByText(teamName, { exact: true }),
      ).toBeVisible();
      await expect(guestPage.getByText(/^申请于 /)).toBeVisible();

      // A：审批队列出现 B → 拒绝（ConfirmModal 二次确认）。
      await page.goto(`/space/${teamSlug}/settings`);
      await expect(
        page.getByRole("heading", { name: "加入申请（1）" }),
      ).toBeVisible();
      await expect(page.getByText(guestName, { exact: true })).toBeVisible();

      // 审批按钮 aria-label 携带申请人名（数据驱动定位）。
      await page
        .getByRole("button", { name: `拒绝 ${guestName} 的加入申请` })
        .click();
      const declineDialog = page.getByRole("dialog");
      await expect(
        declineDialog.getByText("拒绝加入申请", { exact: true }),
      ).toBeVisible();
      await declineDialog
        .getByRole("button", { name: /^拒\s*绝$/ })
        .click();
      await expect(page.getByText("已拒绝加入申请")).toBeVisible();
      await expect(
        page.getByText("暂无待处理的加入申请"),
      ).toBeVisible();

      // B：刷新 /invites，看到「未通过」tag。
      await guestPage.goto("/invites");
      await expect(
        guestPage.getByRole("heading", { name: "我的加入申请（1）" }),
      ).toBeVisible();
      await expect(
        guestPage.getByText("未通过", { exact: true }),
      ).toBeVisible();

      // B：被拒后可凭同一加入码再次申请。
      await guestPage.goto("/teams/join");
      await submitJoinCode(guestPage, code);
      await expect(
        guestPage.getByText("申请已提交，等待管理员审批"),
      ).toBeVisible();

      // A：第二次申请进入队列 → 批准。
      await page.goto(`/space/${teamSlug}/settings`);
      await expect(
        page.getByRole("heading", { name: "加入申请（2）" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: `通过 ${guestName} 的加入申请` })
        .click();
      await expect(page.getByText("已通过加入申请")).toBeVisible();
      await expect(
        page.getByText("暂无待处理的加入申请"),
      ).toBeVisible();

      // B：/invites 两次申请分别显示「已通过」/「未通过」。
      await guestPage.goto("/invites");
      await expect(
        guestPage.getByRole("heading", { name: "我的加入申请（2）" }),
      ).toBeVisible();
      await expect(
        guestPage.getByText("已通过", { exact: true }),
      ).toBeVisible();
      await expect(
        guestPage.getByText("未通过", { exact: true }),
      ).toBeVisible();

      // B：通知中心出现批准结果通知（轻量，不断言全部类型）。
      const bell = guestPage.getByTestId(TEST_IDS.shell.notificationBellButton);
      await expect(bell).toHaveAccessibleName(/条未读/);
      await bell.click();
      const approvedBody = `${ownerName} 通过了你加入「${teamName}」的申请`;
      await expect(
        guestPage.getByRole("button").filter({ hasText: approvedBody }),
      ).toHaveCount(1);

      // B：侧栏空间切换器出现团队，进入团队 Dashboard。
      await guestPage
        .locator("aside")
        .getByTestId(TEST_IDS.shell.spaceSwitcherTrigger)
        .click();
      const teamItem = guestPage.getByRole("menuitem", { name: teamName });
      await expect(teamItem).toBeVisible();
      await teamItem.click();
      await expect(guestPage).toHaveURL(
        new RegExp(`/space/${teamSlug}/dashboard$`),
        { timeout: 30_000 },
      );
      await expect(
        guestPage.getByRole("heading", { name: "仪表盘", level: 1 }),
      ).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test("关闭凭码加入后，持旧码申请被拒绝且不产生 500", async ({
    page,
    browser,
  }) => {
    const ownerName = uniqueUsername("e2e_own");
    const guestName = uniqueUsername("e2e_gst");
    const teamName = uniqueLabel("E2E closed team");

    await registerUser(page, ownerName);
    await createTeam(page, teamName);
    const code = await readJoinCode(page);

    // A：关闭「允许凭码加入」开关。
    await page.getByTestId(TEST_IDS.teams.joinCodeSwitch).click();
    await expect(page.getByText("已关闭凭码加入")).toBeVisible();
    await expect(page.getByText("已关闭：成员无法凭码加入")).toBeVisible();

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await registerUser(guestPage, guestName);

      // B：即便持有旧码也提交失败，错误落在加入码字段（不是 500）。
      await guestPage.goto("/teams/join");
      await submitJoinCode(guestPage, code);
      await expect(
        guestPage.getByText("该团队已关闭凭码加入"),
      ).toBeVisible();
      await expect(guestPage).toHaveURL(/\/teams\/join$/);
      await expect(
        guestPage.getByText("申请已提交，等待管理员审批"),
      ).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
