import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 19：项目详情 tabs（概览 / 任务 / 动态）。
 *
 * 覆盖（对照实现计划 Task 10、spec 验收清单）：
 * 1. 个人项目三 tab 可达、缺省概览；任务 tab 内嵌统计 chip + 双视图，
 *    chip 切换保留 `tab=tasks`；
 * 2. 动态 tab：发评论 → 出现；侧栏改状态 → 状态动态出现；删评论（作者）
 *    → 消失，动态行无删除入口；
 * 3. 团队项目：任务 tab 建任务；列表视图打开任务详情，返回链接携带
 *    `tab=tasks&view=list` 并回到原视图。
 */
test.describe.configure({ timeout: 120_000 });

test.describe("flow 19: 项目详情 tabs", () => {
  test("个人项目：tab 切换、统计 chip 保 tab、动态评论与状态时间线", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_prj19");
    const projectName = uniqueLabel("E2E prj tabs");

    await registerUser(page, username);
    await page.goto("/space/personal/dashboard");
    await createPersonalProject(page, projectName);

    // 列表进详情。
    await page.goto("/space/personal/projects");
    await expect(
      page.getByTestId(TEST_IDS.projects.projectsListPage),
    ).toBeVisible();
    const row = page
      .getByTestId(TEST_IDS.projects.projectsListRow)
      .filter({ hasText: projectName });
    await row.locator("a").first().click();
    await expect(page).toHaveURL(/\/space\/personal\/projects\/[^/]+$/);

    // 三 tab 可见，概览缺省激活。
    const overviewTab = page.locator('[role="tab"][data-value="overview"]');
    const tasksTab = page.locator('[role="tab"][data-value="tasks"]');
    const activityTab = page.locator('[role="tab"][data-value="activity"]');
    await expect(overviewTab).toBeVisible();
    await expect(tasksTab).toBeVisible();
    await expect(activityTab).toBeVisible();
    await expect(overviewTab).toHaveAttribute("data-state", "active");

    // 任务 tab：内嵌统计 chip 与看板 / 列表双视图。
    await tasksTab.click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page.locator('[data-filter="overdue"]')).toBeVisible();
    await expect(page.getByTestId("tasks-view-tab-board")).toBeVisible();

    // 统计 chip 切换保留 tab=tasks（KanbanStatStrip preserveParams）。
    await page.locator('[data-filter="overdue"]').click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page).toHaveURL(/overdue=1/);

    // 动态 tab：评论输入区 + 发表评论。
    await activityTab.click();
    await expect(page).toHaveURL(/tab=activity/);
    const composer = page.getByLabel("评论内容");
    await expect(composer).toBeVisible();
    const commentText = "e2e timeline comment";
    await composer.fill(commentText);
    await page.getByRole("button", { name: "发表评论" }).click();
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 30_000 });

    // 侧栏改状态（动态 tab 侧栏常驻）→ 时间线出现状态变更行。
    await page.getByTestId("properties-status-pill").click();
    await page.getByTestId("project-status-option-planned").click();
    await expect(page.getByText("将状态从")).toBeVisible({ timeout: 30_000 });

    // 作者删除评论 → 消失；状态动态行保留（动态不可删）。
    const commentRow = page.locator("li").filter({ hasText: commentText });
    await commentRow.getByRole("button", { name: "删除" }).click();
    await expect(page.getByText(commentText)).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("将状态从")).toBeVisible();
  });

  test("团队项目：任务 tab 建任务，列表详情回跳保 tab 与 view", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_prj19t");
    const teamName = uniqueLabel("E2E tabs team");
    const projectName = uniqueLabel("E2E tabs site");
    const taskTitle = uniqueLabel("E2E tabs task");

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

    await page.goto(`/space/${teamSlug}/projects/new`);
    await page.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
    await page
      .getByTestId(TEST_IDS.projects.teamProjectSubmitButton)
      .click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/projects\/[^/]+$/, {
      timeout: 30_000,
    });

    // 切任务 tab，新建 11 个任务（超过单页容量才出分页行）。
    await page.locator('[role="tab"][data-value="tasks"]').click();
    await expect(page).toHaveURL(/tab=tasks/);
    for (let i = 0; i < 11; i += 1) {
      await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId(TEST_IDS.tasks.titleInput).fill(`${taskTitle} ${i}`);
      await dialog.getByTestId(TEST_IDS.tasks.createSubmitButton).click();
      await expect(dialog).toBeHidden();
    }
    // 双面板常驻挂载：标题同时存在于看板卡与列表行，限定活动面板断言。
    await expect(
      page.getByTestId("tasks-view-panel-board").getByText(`${taskTitle} 0`),
    ).toBeVisible({ timeout: 30_000 });

    // 列表视图（客户端 replaceState：tab=tasks 保留）。
    await page.getByTestId("tasks-view-tab-list").click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/tab=tasks/);

    // 每页条数改 50：交互变化写回 URL（replaceState），tab 保留。
    await page.getByTestId("task-list-page-size").click();
    await page.getByTestId("task-list-page-size-50").click();
    await expect(page).toHaveURL(/size=50/);
    await expect(page).toHaveURL(/tab=tasks/);

    // 切回每页 10 条并翻到第 2 页：page 写回 URL。
    await page.getByTestId("task-list-page-size").click();
    await page.getByTestId("task-list-page-size-10").click();
    await expect(page).not.toHaveURL(/size=/);
    await page.getByTestId("task-list-page-next").click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/tab=tasks/);

    // 打开第 2 页的任务详情：来源参数 from=project + view=list + page=2。
    // 双面板常驻：看板卡的链接在列表视图下不可见，限定列表面板取行链接；
    // 第 2 页只有 1 行（11 任务 / 每页 10 条），列表面板内标题链接唯一。
    await page
      .getByTestId("tasks-view-panel-list")
      .locator("a")
      .filter({ hasText: taskTitle })
      .first()
      .click();
    await expect(page).toHaveURL(/from=project/);
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/page=2/);

    // 返回链接回项目任务 tab 同视图同页。
    const back = page.getByRole("link", { name: "返回项目" });
    await expect(back).toHaveAttribute("href", /tab=tasks/);
    await expect(back).toHaveAttribute("href", /view=list/);
    await expect(back).toHaveAttribute("href", /page=2/);
    await back.click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId("tasks-view-tab-list")).toBeVisible();
  });
});
