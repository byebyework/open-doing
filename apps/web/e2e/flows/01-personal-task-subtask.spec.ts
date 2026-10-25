import { expect, test } from "@playwright/test";

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

    await page.getByPlaceholder("＋ 添加子任务").fill(subtaskTitle);
    // antd 会在两个汉字之间自动插入空格（「添 加」），用正则匹配两种形态。
    await page.getByRole("button", { name: /^添\s*加$/ }).click();

    const checkbox = page.getByRole("checkbox", { name: subtaskTitle });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    // 刷新后仍为已完成：验证子任务勾选已持久化。
    // 用 toPass 重试整段刷新，避免在 Server Action 落库前读取到旧的乐观状态。
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByRole("checkbox", { name: subtaskTitle }),
      ).toBeChecked();
      await expect(
        page.getByRole("heading", { name: "子任务 · 1/1" }),
      ).toBeVisible();
    }).toPass();
  });
});
