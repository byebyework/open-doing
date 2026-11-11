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
 * 关键流 14：任务优先级 + 操作列权限（2026-11 任务列表改造）。
 *
 * 覆盖：
 * 1. 优先级往返：新建任务选「高」→ 列表 chip 高 → 详情改「低」→
 *    列表 chip 低 → 空间看板色点低；
 * 2. 团队 member 权限：他人任务无删除按钮、状态下拉禁用（owner 反向可见）。
 */
test.describe.configure({ timeout: 120_000 });

/** 优先级档位 → zh 消息包选项文案（createPersonalTask 同款映射）。 */
const PRIORITY_LABELS = { low: "低", medium: "中", high: "高" } as const;

test.describe("flow 14: 任务优先级", () => {
  test("优先级往返:建任务选高 → 详情改低 → 列表 chip / 看板色点变低", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_pri");
    const projectName = uniqueLabel("E2E pri project");
    const taskTitle = uniqueLabel("E2E pri task");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);

    // 新建任务选「高」，列表 chip 立即显示高档位。
    await createPersonalTask(page, { title: taskTitle, priority: "high" });
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: taskTitle })
        .getByTestId(TEST_IDS.tasks.priorityChip),
    ).toHaveAttribute("data-priority", "high");

    // 详情页把优先级改成「低」（MetaRow Select）。
    await openPersonalTask(page, taskTitle);
    await page.getByTestId(TEST_IDS.tasks.detailPrioritySelect).click();
    await page.getByRole("option", { name: PRIORITY_LABELS.low }).click();
    await expect(
      page.getByTestId(TEST_IDS.tasks.detailPrioritySelect),
    ).toContainText(PRIORITY_LABELS.low);

    // 回列表：chip 变低（整页导航，服务端取数为准，无乐观窗口）。
    await openPersonalProject(page, projectName);
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: taskTitle })
        .getByTestId(TEST_IDS.tasks.priorityChip),
    ).toHaveAttribute("data-priority", "low");

    // 空间看板：卡面渲染低档色点（新用户仅此一张卡，first() 唯一）。
    await page.goto("/space/personal/kanban");
    await expect(page.getByTestId(TEST_IDS.tasks.priorityDot).first())
      .toBeVisible();
    await expect(
      page
        .locator(`[aria-label="${taskTitle}"]`)
        .getByTestId(TEST_IDS.tasks.priorityDot),
    ).toHaveAttribute("data-priority", "low");
  });

  test("member 对他人任务:无删除按钮、状态下拉禁用;owner 可见删除", async ({
    page,
    browser,
  }) => {
    const ownerName = uniqueUsername("e2e_prio");
    const guestName = uniqueUsername("e2e_prig");
    const teamName = uniqueLabel("E2E pri team");
    const projectName = uniqueLabel("E2E pri shared");
    const taskTitle = uniqueLabel("E2E pri owner task");

    await registerUser(page, ownerName);
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

    // owner 建项目并新建任务（默认责任人 = owner 自己）。
    await page.goto(`/space/${teamSlug}/projects/new`);
    await page
      .getByTestId(TEST_IDS.projects.teamProjectNameInput)
      .fill(projectName);
    await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
    await expect(page).toHaveURL(/\/space\/[^/]+\/projects\/[^/]+$/, {
      timeout: 30_000,
    });
    await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    await dialog.getByTestId(TEST_IDS.tasks.titleInput).fill(taskTitle);
    await dialog.getByTestId(TEST_IDS.tasks.createSubmitButton).click();
    await expect(dialog).toBeHidden();

    // 邀请 + 接受（同 flow 13 的路径）。
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await registerUser(guestPage, guestName);
      await guestPage.goto("/invites");
      const uid = (
        await guestPage.getByTestId(TEST_IDS.teams.accountUid).innerText()
      ).trim();
      await page.goto(`/space/${teamSlug}/settings`);
      await page
        .getByTestId(TEST_IDS.teams.inviteUidInput)
        .fill(uid.replace(/^doing_/, ""));
      await page.getByTestId(TEST_IDS.teams.inviteSendButton).click();
      await expect(
        page.getByTestId(TEST_IDS.teams.invitePendingHeading),
      ).toContainText("1");

      await guestPage.goto("/invites");
      await guestPage.getByTestId(TEST_IDS.teams.inviteAcceptButton).click();
      await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();

      // owner 视角：操作列有删除按钮，状态下拉可用。
      await page.goto(`/space/${teamSlug}/projects/${projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`);
      const ownerRow = page.getByRole("row").filter({ hasText: taskTitle });
      await expect(ownerRow.getByTestId(TEST_IDS.tasks.rowDelete)).toBeVisible();
      await expect(
        ownerRow.getByTestId(TEST_IDS.tasks.statusMenuTrigger),
      ).toBeEnabled();

      // member 视角：无删除按钮，状态下拉禁用（badge 退化为只读展示）。
      await guestPage.goto(`/space/${teamSlug}/projects/${projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`);
      const guestRow = guestPage.getByRole("row").filter({ hasText: taskTitle });
      await expect(guestRow).toBeVisible();
      await expect(
        guestRow.getByTestId(TEST_IDS.tasks.rowDelete),
      ).toHaveCount(0);
      await expect(
        guestRow.getByTestId(TEST_IDS.tasks.statusMenuTrigger),
      ).toBeDisabled();
    } finally {
      await guestContext.close();
    }
  });
});
