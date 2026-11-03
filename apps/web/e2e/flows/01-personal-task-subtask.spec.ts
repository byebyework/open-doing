import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  openPersonalTask,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 1：注册 → 建个人项目 → 建任务 → 勾选子任务。
 *
 * 账号由注册页创建，全部写操作走 Server Action + 真实数据库；
 * 子任务勾选后刷新页面仍为已完成，确认不是纯客户端状态。
 */
test.describe("flow 1: 个人项目与子任务", () => {
  test("新用户创建项目、任务并勾选子任务", async ({ page }) => {
    const username = uniqueUsername("e2e_p1");
    const projectName = uniqueLabel("E2E project");
    const taskTitle = uniqueLabel("E2E task");
    const subtaskTitle = uniqueLabel("E2E subtask");

    await registerUser(page, username);

    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);

    await createPersonalTask(page, { title: taskTitle });
    await openPersonalTask(page, taskTitle);

    await page.getByTestId(TEST_IDS.tasks.subtaskInput).fill(subtaskTitle);
    await page.getByTestId(TEST_IDS.tasks.subtaskAddButton).click();

    const checkbox = page.getByRole("checkbox", { name: subtaskTitle });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    // 刷新后仍为已完成：验证子任务勾选已持久化（标题里的 1/1 计数同步断言）。
    // 用 toPass 重试整段刷新，避免在 Server Action 落库前读取到旧的乐观状态。
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByRole("checkbox", { name: subtaskTitle }),
      ).toBeChecked();
      await expect(page.getByTestId(TEST_IDS.tasks.subtaskHeading)).toContainText(
        "1/1",
      );
    }).toPass();
  });

  test("编辑任务弹窗重开后回显任务当前值", async ({ page }) => {
    const username = uniqueUsername("e2e_editr");
    const projectName = uniqueLabel("E2E edit reset project");
    const taskTitle = uniqueLabel("E2E edit reset task");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: taskTitle });
    await openPersonalTask(page, taskTitle);

    // 打开编辑弹窗 → 改标题（不保存）→ Esc 关闭 → 重开：应回显任务的当前值。
    await page.getByTestId(TEST_IDS.tasks.editOpenButton).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("标题", { exact: true }).fill("改过的标题");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByTestId(TEST_IDS.tasks.editOpenButton).click();
    await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
      taskTitle,
    );
  });
});
