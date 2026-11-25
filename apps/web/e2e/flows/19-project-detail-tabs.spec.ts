import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 19：项目详情 tabs（概览 / 任务 / 动态，任务 tab 为纯列表）。
 *
 * 覆盖（对照实现计划 Task 6、spec 验收清单）：
 * 1. 个人项目三 tab 可达、缺省概览；任务 tab 只有列表 + 状态/优先级筛选
 *    （无看板 / 无统计 chip）；筛选写进 URL 且切 tab 往返后仍生效；
 * 2. 动态 tab：发评论 → 出现；侧栏改状态 → 状态动态出现；删评论（作者）
 *    → 消失，动态行无删除入口；
 * 3. 团队项目：任务 tab 建任务；列表打开任务详情，返回链接携带
 *    `tab=tasks&view=list&page` 并回到原页。
 */
test.describe.configure({ timeout: 120_000 });

test.describe("flow 19: 项目详情 tabs", () => {
  test("个人项目：纯列表任务 tab + 筛选 URL 往返、动态评论与状态时间线", async ({
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

    // 任务 tab：纯列表——只有状态/优先级筛选，没有看板切换与统计 chip。
    await tasksTab.click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page.getByTestId("task-filter-status")).toBeVisible();
    await expect(page.getByTestId("task-filter-priority")).toBeVisible();
    await expect(page.getByTestId("tasks-view-tab-board")).toHaveCount(0);
    await expect(page.locator('[data-filter="overdue"]')).toHaveCount(0);

    // 状态筛选写进 URL 且保留 tab。
    await page.getByTestId("task-filter-status").click();
    await page.getByTestId("task-filter-status-option-in_progress").click();
    await expect(page).toHaveURL(/status=in_progress/);
    await expect(page).toHaveURL(/tab=tasks/);

    // 切到动态再切回：URL 仍带筛选，触发器回显已选值（重挂从 URL 还原）。
    await activityTab.click();
    await expect(page).toHaveURL(/tab=activity/);
    await tasksTab.click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page).toHaveURL(/status=in_progress/);
    await expect(page.getByTestId("task-filter-status")).toContainText(
      "进行中",
    );

    // 动态 tab：评论输入区（rows=6）+ 发表评论。
    await activityTab.click();
    await expect(page).toHaveURL(/tab=activity/);
    const composer = page.getByLabel("评论内容");
    await expect(composer).toBeVisible();
    await expect(composer).toHaveAttribute("rows", "6");
    const commentText = "e2e timeline comment";
    await composer.fill(commentText);
    await page.getByRole("button", { name: "发表评论" }).click();
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 30_000 });

    // 线程默认收起：0 回复 pill「回复」；点开出现线程底部回复输入框。
    const toggle = page.getByTestId("thread-replies-toggle");
    await expect(toggle).toContainText("回复");
    await toggle.click();
    const replyBox = page.getByLabel("回复内容");
    await expect(replyBox).toBeVisible();
    await expect(replyBox).toHaveAttribute("rows", "6");

    const replyText = "e2e thread reply";
    await replyBox.fill(replyText);
    // 主输入区空稿时提交按钮也存在：把发表按钮限定在线程块（ul）内。
    await page
      .locator("ul")
      .getByRole("button", { name: "发表评论" })
      .click();
    await expect(page.getByText(replyText)).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toContainText("1 条回复");

    // 侧栏改状态（动态 tab 侧栏常驻）→ 时间线出现状态变更行。
    await page.getByTestId("properties-status-pill").click();
    await page.getByTestId("project-status-option-planned").click();
    await expect(page.getByText("将状态从")).toBeVisible({ timeout: 30_000 });

    // 作者删除根评论 → 级联回复一并消失；状态动态行保留（动态不可删）。
    const commentRow = page.locator("li").filter({ hasText: commentText });
    await commentRow.getByRole("button", { name: "删除" }).first().click();
    await expect(page.getByText(commentText)).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(replyText)).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("将状态从")).toBeVisible();
  });

  test("团队项目：任务 tab 建任务，列表详情回跳保 tab 与 page", async ({
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
    // 纯列表：第一页直接可见（无看板卡 / 无双面板）。
    // 列表按创建倒序分页（10..1 在第 1 页，…0 在第 2 页），断首行。
    await expect(page.getByText(`${taskTitle} 10`)).toBeVisible({
      timeout: 30_000,
    });

    // 状态筛选写进 URL（全部任务都是待办，行数不变）。
    await page.getByTestId("task-filter-status").click();
    await page.getByTestId("task-filter-status-option-todo").click();
    await expect(page).toHaveURL(/status=todo/);
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

    // 打开第 2 页的任务详情：来源参数 from=project + view=list + page=2 + 筛选。
    // 第 2 页只有 1 行（11 任务 / 每页 10 条），标题链接唯一。
    await page
      .locator("a")
      .filter({ hasText: taskTitle })
      .first()
      .click();
    await expect(page).toHaveURL(/from=project/);
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/status=todo/);

    // 返回链接回项目任务 tab：同视图同页 + 筛选一并还原。
    const back = page.getByRole("link", { name: "返回项目" });
    await expect(back).toHaveAttribute("href", /tab=tasks/);
    await expect(back).toHaveAttribute("href", /view=list/);
    await expect(back).toHaveAttribute("href", /page=2/);
    await expect(back).toHaveAttribute("href", /status=todo/);
    await back.click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/status=todo/);
    await expect(page.getByTestId("task-filter-status")).toContainText("待办");
  });
});
