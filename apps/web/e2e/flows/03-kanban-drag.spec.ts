import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  personalProjectSlug,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 3：看板拖卡（空间看板）。
 *
 * 项目页已收敛为概览：任务看板在 `/space/personal/tasks`（`?project={slug}`
 * 可按项目过滤，页头「新建任务」弹窗默认选中当前项目），建卡经任务模块
 * 页头弹窗。用 `page.mouse` 按下 → 移动 → 释放模拟 @dnd-kit 的
 * PointerSensor，把「未开始」列的任务拖到「进行中」列，断言列归属变化，
 * 并通过刷新页面确认状态已写入数据库。
 */
test.describe("flow 3: 看板拖拽", () => {
  test("拖到下一列后任务状态持久化", async ({ page }) => {
    const username = uniqueUsername("e2e_kb");
    const projectName = uniqueLabel("E2E board");
    const taskTitle = uniqueLabel("E2E draggable");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);

    // 任务模块看板按项目过滤：建卡助手收尾停在「列表」视图断言任务行，
    // 拖拽前回到看板视图。
    const boardPath = `/space/personal/tasks?project=${personalProjectSlug(projectName)}`;
    await page.goto(boardPath);
    await createPersonalTask(page, { title: taskTitle });
    await page.goto(boardPath);

    const todoColumn = page.getByTestId(TEST_IDS.kanban.spaceColumnTodo);
    const inProgressColumn = page.getByTestId(TEST_IDS.kanban.spaceColumnInProgress);

    // 卡片以任务标题作为 aria-label（数据驱动定位，与文案无关）。
    const card = todoColumn.getByLabel(taskTitle);
    await expect(card).toBeVisible();
    await expect(inProgressColumn).toBeVisible();

    // 等待客户端水合完成（dnd-kit 的监听在挂载后才会绑定）。
    await page.waitForTimeout(500);

    const sourceBox = await card.boundingBox();
    const targetBox = await inProgressColumn.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const startX = sourceBox!.x + sourceBox!.width / 2;
    const startY = sourceBox!.y + sourceBox!.height / 2;
    const endX = targetBox!.x + targetBox!.width / 2;
    const endY = targetBox!.y + 80;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // PointerSensor 有 6px 激活距离：先小幅移动再移动到目标列。
    await page.mouse.move(startX + 10, startY + 10, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 20 });
    await page.mouse.up();

    await expect(
      inProgressColumn.getByText(taskTitle, { exact: true }),
    ).toBeVisible();

    // 刷新后仍在「进行中」列：Server Action 已持久化。
    // 用 toPass 重试整段刷新，避免在 Server Action 落库前读取到旧的乐观状态。
    await expect(async () => {
      await page.reload();
      await expect(
        page
          .getByTestId(TEST_IDS.kanban.spaceColumnInProgress)
          .getByText(taskTitle, { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByTestId(TEST_IDS.kanban.spaceColumnTodo)
          .getByText(taskTitle, { exact: true }),
      ).toHaveCount(0);
    }).toPass();
  });

  test("新建任务弹窗重开后不残留上次输入", async ({ page }) => {
    const username = uniqueUsername("e2e_kbreset");
    const projectName = uniqueLabel("E2E reset board");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);

    // 打开 → 输入 → Esc 关闭 → 重开：标题应为空（antd resetFields 语义）。
    await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId(TEST_IDS.tasks.titleInput).fill("草稿残留检查");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();
    await expect(
      page.getByRole("dialog").getByTestId(TEST_IDS.tasks.titleInput),
    ).toHaveValue("");
  });
});
