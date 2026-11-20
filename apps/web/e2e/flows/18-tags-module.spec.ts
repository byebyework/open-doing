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
 * 双类型标签（项目/任务）创建、tabs 过滤、搜索、项目打标（编辑弹层）
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

    // 4. 项目编辑弹层打标（只列项目标签）
    await openPersonalProject(page, projectName);
    await page.getByRole("button", { name: "编辑" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("task-tag-picker-trigger").click();
    await expect(dialog.getByRole("checkbox", { name: projTagName })).toBeVisible();
    await dialog.getByRole("checkbox", { name: projTagName }).click();
    // 多选 Popover 选中后保持展开（可连续勾选）；再点触发器收起，避免遮挡提交按钮。
    await dialog.getByTestId("task-tag-picker-trigger").click();
    await dialog.getByTestId("personal-project-submit-button").click();
    await expect(page.getByText("没有待处理的邀请。")).toHaveCount(0); // 弹层收起后页面稳定

    // 5. 项目列表行：项目标签 pill 可见
    await page.goto("/space/personal/projects");
    const row = page.getByTestId(TEST_IDS.projects.projectsListRow).filter({ hasText: projectName });
    await expect(row.getByTestId("tag-pill")).toHaveText(projTagName);
  });
});
