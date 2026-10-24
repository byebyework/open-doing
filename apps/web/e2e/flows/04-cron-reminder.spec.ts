import { expect, test } from "@playwright/test";

import { E2E_CRON_SECRET } from "../utils/env";
import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  registerUser,
  shanghaiToday,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/** 发起真实 cron 扫描（Bearer 鉴权），返回解析后的 JSON。 */
async function runDueScan(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ ok: boolean; dueSoon: number; overdue: number }> {
  const response = await request.post("/api/cron/due-scan", {
    headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    ok: boolean;
    dueSoon: number;
    overdue: number;
  };
}

/**
 * 关键流 4：cron 到期提醒与幂等。
 *
 * 建一个「今天截止」的个人任务 → 真实 POST /api/cron/due-scan →
 * 通知铃铛出现 `task_due_soon` 文案；再次调用返回 0 且通知不重复。
 *
 * 整套用例串行执行且 globalSetup 已清库，因此扫描计数可精确断言。
 */
test.describe("flow 4: cron 到期提醒", () => {
  test("到期扫描生成提醒且重复调用幂等", async ({
    page,
    request,
  }) => {
    const username = uniqueUsername("e2e_cron");
    const projectName = uniqueLabel("E2E cron project");
    const taskTitle = uniqueLabel("E2E due task");
    const today = shanghaiToday();

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: taskTitle, dueDate: today });

    // 第一次扫描：恰好新增 1 条 task_due_soon。
    await expect(runDueScan(request)).resolves.toEqual({
      ok: true,
      dueSoon: 1,
      overdue: 0,
    });

    // 铃铛角标与通知文案（task_due_soon 的展示文案）。
    await page.goto("/my");
    const bell = page.getByRole("button", { name: /^通知/ });
    await expect(bell).toHaveAccessibleName(/1 条未读/);
    await bell.click();

    const notificationBody = `你负责的「${taskTitle}」今日/明日到期`;
    await expect(page.getByText(notificationBody, { exact: true })).toBeVisible();
    const notificationItems = page
      .getByRole("button")
      .filter({ hasText: notificationBody });
    await expect(notificationItems).toHaveCount(1);

    // 第二次扫描：幂等，不再新增。
    await expect(runDueScan(request)).resolves.toEqual({
      ok: true,
      dueSoon: 0,
      overdue: 0,
    });

    await page.reload();
    await page.getByRole("button", { name: /^通知/ }).click();
    await expect(
      page.getByRole("button").filter({ hasText: notificationBody }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /^通知/ }),
    ).toHaveAccessibleName(/1 条未读/);
  });
});
