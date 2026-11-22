import { expect, test, type Page } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 17：任务标签全生命周期（标签模块上线后改版）。
 * 标签创建/删除走「标签」模块页；任务打标走任务详情 meta 行。
 */
test.describe.configure({ timeout: 180_000 });

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
  const dialog = page.getByTestId(TEST_IDS.projects.projectsCreateDialog);
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
  await dialog.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
  await expect(
    page.getByTestId(TEST_IDS.projects.projectsListRow).filter({ hasText: projectName }),
  ).toBeVisible({ timeout: 30_000 });
}

function projectSlug(projectName: string): string {
  return projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

test.describe("flow 17: 任务标签", () => {
  test("模块页建任务标签 → 任务打标 → 详情 meta 行 → 删除级联", async ({ page }) => {
    const username = uniqueUsername("e2etag17");
    const teamName = uniqueLabel("E2E t17 team");
    const projectName = uniqueLabel("E2E t17 project");
    const taskTitle = uniqueLabel("E2E t17 task");
    const tagName = uniqueLabel("Res");

    await registerUser(page, username);
    const teamSlug = await createTeam(page, teamName);
    await createTeamProject(page, teamSlug, projectName);

    // 1. 标签模块：建任务标签
    await page.goto(`/space/${teamSlug}/tags`);
    await expect(page.getByTestId("tags-module-page")).toBeVisible();
    await page.getByTestId("tags-new-button").click();
    const dialog = page.getByTestId("tag-form-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("tagform-name-input").fill(tagName);
    await page.getByTestId("tagform-type-task").click();
    await page.getByTestId("tagform-submit").click();
    await expect(page.getByTestId("tags-module-row").filter({ hasText: tagName })).toBeVisible();

    // 2. 项目详情：新建任务并在弹窗打标
    const projectPath = `/space/${teamSlug}/projects/${projectSlug(projectName)}`;
    await page.goto(projectPath);
    await page.getByTestId("new-task-button").click();
    const taskDialog = page.getByRole("dialog");
    await expect(taskDialog).toBeVisible();
    await taskDialog.getByTestId("task-title-input").fill(taskTitle);
    await taskDialog.getByTestId("task-tag-picker-trigger").click();
    await taskDialog.getByRole("checkbox", { name: tagName }).click();
    await taskDialog.getByTestId("task-create-submit-button").click();
    await expect(page.getByText("任务已创建")).toBeVisible();

    // 3. 表格标签列可见 pill（项目页只渲染概览：任务列表在任务模块 ?view=list）
    const taskListPath = `/space/${teamSlug}/tasks?view=list&project=${projectSlug(projectName)}`;
    await page.goto(taskListPath);
    const taskRow = page
      .getByTestId(TEST_IDS.kanban.taskTable)
      .getByRole("row")
      .filter({ hasText: taskTitle });
    await expect(taskRow.getByTestId("tag-pill")).toHaveText(tagName);

    // 4. 详情 meta 行（标签在右侧卡片内）
    await taskRow.getByRole("link").first().click();
    await expect(page.getByTestId("task-tags-cell")).toBeVisible();
    await expect(page.getByTestId("task-tags-cell").getByTestId("tag-pill")).toHaveText(tagName);

    // 5. 删除标签 → 表格 pill 消失（级联）
    await page.goto(`/space/${teamSlug}/tags`);
    await page.locator("[data-testid^='tags-delete-']").first().click();
    await page.getByTestId("tags-delete-confirm").click();
    await expect(page.getByTestId("tags-module-row")).toHaveCount(0);

    await page.goto(taskListPath);
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.taskTable)
        .getByRole("row")
        .filter({ hasText: taskTitle }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.taskTable)
        .getByRole("row")
        .filter({ hasText: taskTitle })
        .getByTestId("tag-pill"),
    ).toHaveCount(0);
  });
});
