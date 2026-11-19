import { expect, test, type Page } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  loginUser,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 17：项目标签全生命周期（2026-11 标签功能）。
 *
 * 覆盖（spec §6.2/§6.3/§6.4）：
 * 1. owner 在项目页标签管理弹层建标签（预设色板）；
 * 2. 新建团队任务弹窗打标 → 看板卡片 pill 可见；
 * 3. member：无标签管理入口，但可在自己任务上打标（task:edit）；
 * 4. 团队 Analysis「按标签」区可见计数；
 * 5. 删除标签后任务页 pill 消失（级联清理）。
 */
test.describe.configure({ timeout: 180_000 });

/** 团队设置页邀请成员并让成员接受（沿 flow 02 的邀请流程）。 */
async function inviteAndJoin(
  ownerPage: Page,
  guestPage: Page,
  teamSlug: string,
): Promise<void> {
  await ownerPage.goto(`/space/${teamSlug}/settings`);

  // B 读取自己的 UID（/invites 页）。
  await guestPage.goto("/invites");
  const uid = (
    await guestPage.getByTestId(TEST_IDS.teams.accountUid).innerText()
  ).trim();
  expect(uid).toMatch(/^doing_[a-z0-9]+$/);

  // A 输入 UID 后缀发起邀请，待处理计数变 1。
  await ownerPage.getByTestId(TEST_IDS.teams.inviteUidInput).fill(uid.replace(/^doing_/, ""));
  await ownerPage.getByTestId(TEST_IDS.teams.inviteSendButton).click();
  await expect(ownerPage.getByTestId(TEST_IDS.teams.invitePendingHeading)).toContainText("1");

  // B 接受邀请，待处理分区清零。
  await guestPage.goto("/invites");
  await guestPage.getByTestId(TEST_IDS.teams.inviteAcceptButton).click();
  await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();
}

async function createTeam(page: Page, teamName: string): Promise<string> {
  await page.goto("/teams/new");
  await expect(page.getByTestId(TEST_IDS.teams.createTeamHeading)).toBeVisible();
  await page.getByTestId(TEST_IDS.teams.teamNameInput).fill(teamName);
  await page.getByTestId(TEST_IDS.teams.createTeamButton).click();
  await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, { timeout: 30_000 });
  return decodeURIComponent(new URL(page.url()).pathname.split("/")[2] ?? "");
}

async function createTeamProject(
  page: Page,
  teamSlug: string,
  projectName: string,
): Promise<void> {
  await page.goto(`/space/${teamSlug}/projects`);
  await page.getByTestId(TEST_IDS.projects.projectsNewTeamButton).click();
  await expect(page).toHaveURL(
    new RegExp(`/space/${teamSlug}/projects/new$`),
    { timeout: 30_000 },
  );
  await page.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
  await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
  await expect(page).toHaveURL(
    /\/space\/[^/]+\/projects\/[^/]+$/,
    { timeout: 30_000 },
  );
}

/** 项目详情 slug（createTeamProject 后由 URL 推导；沿 personalProjectSlug 口径）。 */
function teamProjectSlug(projectName: string): string {
  return (
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

test.describe("flow 17: 项目标签", () => {
  test("建标签 → 任务打标 → 看板 pill → member 边界 → 分析可见 → 删除级联", async ({
    page,
    browser,
  }) => {
    const ownerName = uniqueUsername("e2etag_o");
    const memberName = uniqueUsername("e2etag_m");
    const teamName = uniqueLabel("E2E tag team");
    const projectName = uniqueLabel("E2E tag project");
    const ownerTaskTitle = uniqueLabel("E2E tag owner task");
    const memberTaskTitle = uniqueLabel("E2E tag member task");
    const tagName = uniqueLabel("Res");

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    // 1. owner 建团队 + 项目 + 标签
    await registerUser(ownerPage, ownerName);
    const teamSlug = await createTeam(ownerPage, teamName);
    await createTeamProject(ownerPage, teamSlug, projectName);

    await ownerPage.goto(`/space/${teamSlug}/projects`);
    await ownerPage.getByTestId("tags-manage-button").click();
    const manager = ownerPage.getByTestId("tag-manager");
    await expect(manager).toBeVisible();
    await ownerPage.getByTestId("tag-name-input").fill(tagName);
    await ownerPage.getByTestId("tag-create-submit").click();
    await expect(manager.getByTestId("tag-list")).toContainText(tagName);
    await ownerPage.keyboard.press("Escape");

    // 2. 项目页新建任务并打标（表单受控多选）
    await ownerPage.goto(
      `/space/${teamSlug}/projects/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    );
    await ownerPage.getByTestId("new-task-button").click();
    const taskDialog = ownerPage.getByRole("dialog");
    await expect(taskDialog).toBeVisible();
    await taskDialog.getByTestId("task-title-input").fill(ownerTaskTitle);
    await taskDialog.getByTestId("task-tag-picker-trigger").click();
    await taskDialog.getByRole("checkbox", { name: tagName }).click();
    await taskDialog.getByTestId("task-create-submit-button").click();
    // 等创建 toast：action 提交完成（含 task_tags 落库）再导航。
    await expect(ownerPage.getByText("任务已创建")).toBeVisible();
    await expect(ownerPage.getByTestId("new-task-button")).toBeVisible();

    // 3. 看板卡片 pill 可见（项目详情页 board 视图）
    const projectPath = `/space/${teamSlug}/projects/${teamProjectSlug(projectName)}`;
    await ownerPage.goto(`${projectPath}?view=board`);
    const card = ownerPage.locator(`[aria-label="${ownerTaskTitle}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId("tag-pill")).toHaveText(tagName);

    // 4. member 加入团队：无管理入口，但给自己任务打标
    await registerUser(memberPage, memberName);
    await inviteAndJoin(ownerPage, memberPage, teamSlug);

    await memberPage.goto(projectPath);
    await expect(memberPage.getByTestId("tags-manage-button")).toHaveCount(0);
    await memberPage.getByTestId("new-task-button").click();
    const memberDialog = memberPage.getByRole("dialog");
    await expect(memberDialog).toBeVisible();
    await memberDialog.getByTestId("task-title-input").fill(memberTaskTitle);
    await memberDialog.getByTestId("task-tag-picker-trigger").click();
    await memberDialog.getByRole("checkbox", { name: tagName }).click();
    await memberDialog.getByTestId("task-create-submit-button").click();
    await expect(memberPage.getByText("任务已创建")).toBeVisible();
    await expect(memberPage.getByTestId("new-task-button")).toBeVisible();

    // 5. 团队 Analysis「按标签」区可见计数（member 任务为未完成 → openCount）
    await ownerPage.goto(`/space/${teamSlug}/analysis`);
    await expect(ownerPage.getByTestId("tag-pill").first()).toContainText(tagName);

    // 6. owner 删除标签 → 看板 pill 消失（级联）
    await ownerPage.goto(`/space/${teamSlug}/projects`);
    await ownerPage.getByTestId("tags-manage-button").click();
    const row = manager.getByTestId("tag-row").filter({ hasText: tagName });
    await row.locator("button[data-testid^='tag-delete-']").click();
    await ownerPage.getByTestId("tag-delete-confirm").click();
    await expect(manager.getByTestId("tag-row")).toHaveCount(0);
    await ownerPage.keyboard.press("Escape");

    await ownerPage.goto(`${projectPath}?view=board`);
    await expect(ownerPage.getByTestId("tag-pill")).toHaveCount(0);

    await ownerContext.close();
    await memberContext.close();
  });
});
