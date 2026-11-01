import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 3：看板拖卡。
 *
 * 用 `page.mouse` 按下 → 移动 → 释放，模拟 @dnd-kit 的 PointerSensor；
 * 把「未开始」列的任务拖到「进行中」列，断言列归属变化，并通过刷新页面
 * 确认状态已写入数据库。
 */
test.describe("flow 3: 看板拖拽", () => {
  test("拖到下一列后任务状态持久化", async ({ page }) => {
    const username = uniqueUsername("e2e_kb");
    const projectName = uniqueLabel("E2E board");
    const taskTitle = uniqueLabel("E2E draggable");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);

    const projectPath = new URL(page.url()).pathname;
    await createPersonalTask(page, { title: taskTitle });

    // 直接用 ?view=board 进入看板，避免依赖 Segmented 的内部 DOM 结构。
    await page.goto(`${projectPath}?view=board`);

    const todoColumn = page.getByTestId(TEST_IDS.kanban.columnTodo);
    const inProgressColumn = page.getByTestId(TEST_IDS.kanban.columnInProgress);

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
          .getByTestId(TEST_IDS.kanban.columnInProgress)
          .getByText(taskTitle, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByTestId(TEST_IDS.kanban.columnTodo).getByText(taskTitle, {
          exact: true,
        }),
      ).toHaveCount(0);
    }).toPass();
  });
});
