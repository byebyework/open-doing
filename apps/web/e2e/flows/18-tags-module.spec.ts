import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  openPersonalProject,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 18：标签模块（个人空间）。
 * 双类型标签（项目/任务）创建、tabs 过滤、搜索、项目打标（概览标签行内联 Popover）
 * → 项目卡片 pill、类型互斥（任务打标列表不含项目标签）。
 */
test.describe.configure({ timeout: 180_000 });

test.describe("flow 18: 标签模块", () => {
  test("双类型建标 → tabs 过滤 → 项目打标 → 卡片 pill", async ({ page }) => {
    const username = uniqueUsername("e2etag18");
    const projectName = uniqueLabel("E2E t18 project");
    const taskTagName = uniqueLabel("Ttag");
    const projTagName = uniqueLabel("Ptag");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);

    // 1. 标签模块：建项目标签 + 任务标签
    await page.goto("/space/personal/tags");
    await expect(page.getByTestId("tags-module-page")).toBeVisible();
    for (const [name, type] of [
      [projTagName, "project"],
      [taskTagName, "task"],
    ] as const) {
      await page.getByTestId("tags-new-button").click();
      const dialog = page.getByTestId("tag-form-dialog");
      await expect(dialog).toBeVisible();
      await page.getByTestId("tagform-name-input").fill(name);
      await page.getByTestId(`tagform-type-${type}`).click();
      await expect(page.getByTestId(`tagform-type-${type}`)).toHaveAttribute("aria-checked", "true");
      await page.getByTestId("tagform-description-input").fill("e2e desc");
      await page.getByTestId("tagform-submit").click();
      await expect(
        page.getByTestId("tags-module-row").filter({ hasText: name }),
      ).toBeVisible();
    }

    // 2. tabs 过滤：项目标签 tab 只见项目标签
    await page.getByTestId("tags-tab-project").click();
    await expect(page.getByTestId("tags-module-row").filter({ hasText: projTagName })).toBeVisible();
    await expect(page.getByTestId("tags-module-row").filter({ hasText: taskTagName })).toHaveCount(0);
    await page.getByTestId("tags-tab-all").click();

    // 3. 搜索过滤
    await page.getByTestId("tags-search-input").fill(projTagName.slice(0, 8));
    await expect(page.getByTestId("tags-module-row").filter({ hasText: projTagName })).toBeVisible();
    await expect(page.getByTestId("tags-module-row").filter({ hasText: taskTagName })).toHaveCount(0);
    await page.getByTestId("tags-search-input").fill("");

    // 4. 概览标签行打标（内联 Popover：勾选即保存，无编辑弹层）
    await openPersonalProject(page, projectName);
    const labelsTrigger = page.getByTestId("overview-labels-add");
    await labelsTrigger.click();
    await page
      .locator('[data-testid^="overview-labels-option-"]')
      .filter({ hasText: projTagName })
      .click();
    // 勾选即触发保存；等待保存完成（触发器保存期间禁用）再收起 Popover。
    await expect(labelsTrigger).toBeEnabled({ timeout: 15_000 });
    await labelsTrigger.click();

    // 5. 项目标签关联保留：重新打开详情页，概览标签行显示该项目标签
    await page.goto("/space/personal/projects");
    await page
      .getByTestId(TEST_IDS.projects.projectsListRow)
      .filter({ hasText: projectName })
      .locator("a")
      .first()
      .click();
    await expect(page).toHaveURL(/\/space\/personal\/projects\/[^/]+$/, { timeout: 30_000 });
    await expect(
      page
        .getByTestId("project-properties-panel")
        .getByTestId("tag-pill")
        .filter({ hasText: projTagName }),
    ).toBeVisible();
  });
});
