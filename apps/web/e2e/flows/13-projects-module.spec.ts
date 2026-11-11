import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 13：空间级「项目」模块（v1.2，`/space/{spaceRef}/projects`）。
 *
 * 覆盖（对照实现计划 Task 8、spec 验收清单）：
 * 1. 个人列表：侧栏「项目」入口可达、卡片可见、点卡进详情；空态可见；
 * 2. 团队 owner：列表可达、有「新建项目」入口、建项目后卡片出现；
 * 3. 非成员 404（不泄露存在性）+ member 无新建入口、卡片可见。
 */
test.describe.configure({ timeout: 120_000 });

test.describe("flow 13: 项目模块", () => {
  test("个人项目列表:侧栏入口、卡片、点卡进详情、空态", async ({ page }) => {
    const username = uniqueUsername("e2e_prj13");
    const projectA = uniqueLabel("E2E prj A");
    const projectB = uniqueLabel("E2E prj B");

    // 空态:全新用户直接访问列表页。
    await registerUser(page, username);
    await page.goto("/space/personal/projects");
    await expect(page.getByTestId(TEST_IDS.projects.projectsListPage)).toBeVisible();
    await expect(page.getByText("还没有项目")).toBeVisible();

    // 建 2 个个人项目(页头弹窗)后列表出现两张卡。
    await page.goto("/space/personal/dashboard");
    await createPersonalProject(page, projectA);
    await createPersonalProject(page, projectB);

    // 侧栏「项目」入口导航到列表页。
    await page.goto("/space/personal/dashboard");
    await page.getByRole("link", { name: "项目", exact: true }).click();
    await expect(page).toHaveURL(/\/space\/personal\/projects$/, {
      timeout: 30_000,
    });
    const cards = page.getByTestId(TEST_IDS.projects.projectsListCard);
    await expect(cards.filter({ hasText: projectA })).toBeVisible();
    await expect(cards.filter({ hasText: projectB })).toBeVisible();

    // 点卡片进详情页。
    await cards.filter({ hasText: projectA }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/space/personal/projects/${projectA
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")}$`,
      ),
      { timeout: 30_000 },
    );
  });

  test("团队 owner:列表可达、可新建项目、卡片出现", async ({ page }) => {
    const ownerName = uniqueUsername("e2e_prj13o");
    const teamName = uniqueLabel("E2E prj team");
    const projectName = uniqueLabel("E2E prj site");

    await registerUser(page, ownerName);
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

    // owner 可见「新建项目」,点击进表单页。
    await page.goto(`/space/${teamSlug}/projects`);
    await expect(page.getByTestId(TEST_IDS.projects.projectsListPage)).toBeVisible();
    await page.getByTestId(TEST_IDS.projects.projectsNewTeamButton).click();
    await expect(page).toHaveURL(
      new RegExp(`/space/${teamSlug}/projects/new$`),
      { timeout: 30_000 },
    );

    // 建项目后落到详情页,再回列表验证卡片。
    await page.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
    await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
    await expect(page).toHaveURL(
      /\/space\/[^/]+\/projects\/[^/]+$/,
      { timeout: 30_000 },
    );

    await page.goto(`/space/${teamSlug}/projects`);
    await expect(
      page
        .getByTestId(TEST_IDS.projects.projectsListCard)
        .filter({ hasText: projectName }),
    ).toBeVisible();
  });

  test("非成员 404;member 无新建入口、卡片可见", async ({ page, browser }) => {
    const ownerName = uniqueUsername("e2e_prj13m");
    const guestName = uniqueUsername("e2e_prj13g");
    const teamName = uniqueLabel("E2E prj member team");
    const projectName = uniqueLabel("E2E prj shared");

    await registerUser(page, ownerName);
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

    // owner 先建一个团队项目,member 场景才有卡可看。
    await page.goto(`/space/${teamSlug}/projects/new`);
    await page.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
    await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/projects\/[^/]+$/, {
      timeout: 30_000,
    });

    // B:独立上下文注册。
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await registerUser(guestPage, guestName);

      // 受邀前访问团队列表:404,不泄露存在性。
      const response = await guestPage.goto(`/space/${teamSlug}/projects`);
      expect(response?.status()).toBe(404);
      await expect(
        guestPage.getByTestId(TEST_IDS.misc.notFoundMessage),
      ).toBeVisible();

      // 邀请 + 接受。
      await guestPage.goto("/invites");
      const uid = (
        await guestPage.getByTestId(TEST_IDS.teams.accountUid).innerText()
      ).trim();
      await page.goto(`/space/${teamSlug}/settings`);
      await page
        .getByTestId(TEST_IDS.teams.inviteUidInput)
        .fill(uid.replace(/^doing_/, ""));
      await page.getByTestId(TEST_IDS.teams.inviteSendButton).click();
      await expect(
        page.getByTestId(TEST_IDS.teams.invitePendingHeading),
      ).toContainText("1");

      await guestPage.goto("/invites");
      await guestPage.getByTestId(TEST_IDS.teams.inviteAcceptButton).click();
      await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();

      // member 视角:卡片可见,但无「新建项目」。
      await guestPage.goto(`/space/${teamSlug}/projects`);
      await expect(
        guestPage
          .getByTestId(TEST_IDS.projects.projectsListCard)
          .filter({ hasText: projectName }),
      ).toBeVisible();
      await expect(
        guestPage.getByTestId(TEST_IDS.projects.projectsNewTeamButton),
      ).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
