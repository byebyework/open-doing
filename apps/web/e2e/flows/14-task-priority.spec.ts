import { expect, test } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  openPersonalTask,
  personalProjectSlug,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 14：任务优先级 + 行内编辑权限（2026-11 任务列表改造）。
 *
 * 项目页已收敛为概览：任务列表断言一律走任务模块
 * `/space/{spaceRef}/tasks?view=list&project={slug}`（SpaceTaskTable）。
 *
 * 覆盖：
 * 1. 优先级往返：新建任务选「高」→ 列表 chip 高 → 详情改「低」→
 *    列表 chip 低 → 空间看板色点低；
 * 2. 团队 member 权限：他人任务的行内状态按钮禁用、详情页无编辑/删除入口
 *    （owner 反向可见、可用）。
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

    // 新建任务选「高」；助手收尾停在任务模块列表视图，chip 立即显示高档位。
    await createPersonalTask(page, { title: taskTitle, priority: "high" });
    const listPath = `/space/personal/tasks?view=list&project=${personalProjectSlug(projectName)}`;
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.taskTable)
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
    // 项目页只渲染概览：任务列表在任务模块，显式带 ?view=list&project={slug}。
    await page.goto(listPath);
    await expect(
      page
        .getByTestId(TEST_IDS.kanban.taskTable)
        .getByRole("row")
        .filter({ hasText: taskTitle })
        .getByTestId(TEST_IDS.tasks.priorityChip),
    ).toHaveAttribute("data-priority", "low");

    // 空间看板：卡面渲染低档色点（新用户仅此一张卡，first() 唯一）。
    await page.goto("/space/personal/tasks");
    await expect(page.getByTestId(TEST_IDS.tasks.priorityDot).first())
      .toBeVisible();
    await expect(
      page
        .locator(`[aria-label="${taskTitle}"]`)
        .getByTestId(TEST_IDS.tasks.priorityDot),
    ).toHaveAttribute("data-priority", "low");
  });

  test("member 对他人任务:行内状态按钮禁用、详情无编辑/删除入口;owner 可操作", async ({
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

      // 任务模块列表视图（任务页已收敛，项目页只渲染概览）。
      const listPath = `/space/${teamSlug}/tasks?view=list&project=${personalProjectSlug(projectName)}`;

      // owner 视角：他人任务 = 自己的任务，状态 pill 可用且能完整切换
      // （点 pill 弹出菜单 → 点菜单项；菜单 portal 到 body，按 role 锚定）。
      await page.goto(listPath);
      const ownerRow = page
        .getByTestId(TEST_IDS.kanban.taskTable)
        .getByRole("row")
        .filter({ hasText: taskTitle });
      await expect(ownerRow).toBeVisible();
      const ownerPill = ownerRow.getByTestId(TEST_IDS.tasks.taskStatusPill);
      await expect(ownerPill).toBeEnabled();
      await ownerPill.click();
      const ownerMenu = page.getByRole("menu");
      await expect(
        ownerMenu.getByTestId(TEST_IDS.tasks.cardStatusButton("in_progress")),
      ).toBeEnabled();
      await ownerMenu
        .getByTestId(TEST_IDS.tasks.cardStatusButton("in_progress"))
        .click();
      await expect(ownerPill).toContainText("进行中");

      // member 视角：他人任务的状态 pill 禁用（退化为只读展示），
      // 触发器没有菜单语义、菜单项不存在——菜单不可达。
      await guestPage.goto(listPath);
      const guestRow = guestPage
        .getByTestId(TEST_IDS.kanban.taskTable)
        .getByRole("row")
        .filter({ hasText: taskTitle });
      await expect(guestRow).toBeVisible();
      const guestPill = guestRow.getByTestId(TEST_IDS.tasks.taskStatusPill);
      await expect(guestPill).toBeDisabled();
      await expect(guestPill).not.toHaveAttribute("aria-haspopup", "menu");
      // 菜单不可达：行内没有菜单项、页面上也没有打开的状态菜单
      //（看板面板常驻挂载，其移动端卡内按钮不在行作用域内，按 menu role 锚定）。
      await expect(
        guestRow.getByTestId(TEST_IDS.tasks.cardStatusButton("in_progress")),
      ).toHaveCount(0);
      await expect(guestPage.getByRole("menu")).toHaveCount(0);

      // 详情页反向验证删除权限：owner 有「删除任务」入口，member 没有
      // （编辑 / 状态切换按钮同样只对有编辑权的一方渲染）。
      await ownerRow.getByRole("link").first().click();
      await expect(
        page.getByRole("button", { name: "删除任务" }),
      ).toBeVisible();
      await guestRow.getByRole("link").first().click();
      await expect(
        guestPage.getByRole("button", { name: "删除任务" }),
      ).toHaveCount(0);
      await expect(
        guestPage.getByTestId(TEST_IDS.tasks.statusToggle),
      ).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
