import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from "../utils/env";
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
 * 关键流 6：空间级 Kanban（v1.1 M3，`/space/{spaceRef}/tasks`）。
 *
 * 覆盖（对照实现计划的 Task 6、不测 dnd-kit 拖拽本体）：
 * 1. 个人看板三列 + 卡片项目 tag + `?project=` 深链接刷新还原；
 * 2. 团队看板「全部任务 / 未指派」筛选（URL 写入 + 刷新还原）；
 * 3. 移动端（375px）卡内状态按钮流转 + done「查看更早」原地展开可逆。
 *
 * 拖拽逻辑由 flow 3 的空间看板回归覆盖（项目页已收敛为概览，任务看板在
 * `/space/{spaceRef}/tasks`）：dnd-kit 的 PointerSensor 在 Playwright 下
 * 不稳定，空间看板只验证移动端按钮路径。
 */

// 团队用例要建第二个账号（邀请 + 移除），比其它流多一个浏览器上下文。
test.describe.configure({ timeout: 120_000 });

test.describe("flow 6: 空间级 Kanban", () => {
  test("个人看板三列与 ?project 深链接还原", async ({ page }) => {
    const username = uniqueUsername("e2e_kb6");
    const projectA = uniqueLabel("E2E kb A");
    const projectB = uniqueLabel("E2E kb B");
    const taskA = uniqueLabel("E2E kb task A");
    const taskB = uniqueLabel("E2E kb task B");

    await registerUser(page, username);

    // 两个项目各一张卡，才能证明 ?project= 是「只留一项」而不是碰巧全空。
    await createPersonalProject(page, projectA);
    await openPersonalProject(page, projectA);
    await createPersonalTask(page, { title: taskA });

    await page.goto("/space/personal/dashboard");
    await createPersonalProject(page, projectB);
    await openPersonalProject(page, projectB);
    await createPersonalTask(page, { title: taskB });

    await page.goto("/space/personal/tasks");

    // 三列（待办 / 进行中 / 已完成）都是真实 section。
    for (const column of [
      TEST_IDS.kanban.spaceColumnTodo,
      TEST_IDS.kanban.spaceColumnInProgress,
      TEST_IDS.kanban.spaceColumnDone,
    ]) {
      await expect(page.getByTestId(column)).toBeVisible();
    }

    const todo = page.getByTestId(TEST_IDS.kanban.spaceColumnTodo);
    await expect(todo.getByText(taskA, { exact: true })).toBeVisible();
    await expect(todo.getByText(taskB, { exact: true })).toBeVisible();

    // 卡片携带项目 tag：tag 在卡片 aria-label 容器内（即同一张卡）。
    await expect(
      todo.getByLabel(taskA, { exact: true }).getByText(projectA, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      todo.getByLabel(taskB, { exact: true }).getByText(projectB, {
        exact: true,
      }),
    ).toBeVisible();
    // 「当前筛选：…」是计数 + 项目名混合文案，计数是被测行为。
    await expect(page.getByText("当前筛选：全部项目 · 2 个任务")).toBeVisible();

    // 深链接：直接带 ?project= 进入，只保留该项目；刷新后仍是同一视图。
    // 双视图后看板卡片与列表行同屏（非激活面板常驻），标题断言需锚定看板面板。
    const filteredPath = `/space/personal/tasks?project=${personalProjectSlug(projectA)}`;
    const board = page.getByTestId(TEST_IDS.kanban.viewPanelBoard);
    await page.goto(filteredPath);
    await expect(page.getByText(`当前筛选：${projectA} · 1 个任务`)).toBeVisible();
    await expect(board.getByText(taskA, { exact: true })).toBeVisible();
    await expect(page.getByText(taskB, { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(`当前筛选：${projectA} · 1 个任务`)).toBeVisible();
    await expect(board.getByText(taskA, { exact: true })).toBeVisible();
    await expect(page.getByText(taskB, { exact: true })).toHaveCount(0);

    // 非法 slug 静默回退为全部（不 500、不报错），与页面契约一致。
    await page.goto("/space/personal/tasks?project=not-a-real-project");
    await expect(page.getByText("当前筛选：全部项目 · 2 个任务")).toBeVisible();
    await expect(board.getByText(taskA, { exact: true })).toBeVisible();
    await expect(board.getByText(taskB, { exact: true })).toBeVisible();
  });

  test("团队看板未指派筛选", async ({ page, browser }) => {
    const ownerName = uniqueUsername("e2e_kbt");
    const guestName = uniqueUsername("e2e_kbg");
    const teamName = uniqueLabel("E2E kb team");
    const projectName = uniqueLabel("E2E kb project");
    const ownerTask = uniqueLabel("E2E kb owner task");
    const orphanTask = uniqueLabel("E2E kb orphan task");

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

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    async function createTeamTask(title: string, assignee?: string) {
      await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // 等弹窗动效与初始值同步完成后再填写。
      await page.waitForTimeout(500);
      await dialog.getByTestId(TEST_IDS.tasks.titleInput).fill(title);
      if (assignee) {
        // shadcn Select 的选项带 role="option"（迁移前 antd 虚拟列表无此
        // role，旧定位用 .ant-select-item-option）。
        await dialog.getByLabel("责任人").click();
        await page
          .getByRole("option")
          .filter({ hasText: assignee })
          .click();
        // 指派是否正确由后续「移除成员 → 未指派筛选」断言兜底（该卡若仍
        // 归 owner，移除 guest 后不会出现在未指派视图里）。
      }
      await dialog.getByTestId(TEST_IDS.tasks.createSubmitButton).click();

      await expect(dialog).toBeHidden();
      // 项目页已收敛为概览（不渲染任务列表）：到团队任务模块「列表」视图
      // 断言任务行出现，再回项目页继续下一张卡的创建。
      await page.goto(
        `/space/${teamSlug}/tasks?view=list&project=${personalProjectSlug(projectName)}`,
      );
      await expect(
        page
          .getByTestId(TEST_IDS.kanban.taskTable)
          .getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
      await page.goto(`/space/${teamSlug}/projects/${personalProjectSlug(projectName)}`);
    }

    try {
      // 第二个用户接受邀请，成为可被指派的任务责任人。
      await registerUser(guestPage, guestName);
      await guestPage.goto("/invites");
      const uid = (
        await guestPage.getByTestId(TEST_IDS.teams.accountUid).innerText()
      ).trim();

      await page.getByTestId(TEST_IDS.teams.inviteUidInput).fill(uid.replace(/^doing_/, ""));
      await page.getByTestId(TEST_IDS.teams.inviteSendButton).click();
      await expect(
        page.getByTestId(TEST_IDS.teams.invitePendingHeading),
      ).toContainText("1");

      await guestPage.goto("/invites");
      await guestPage.getByTestId(TEST_IDS.teams.inviteAcceptButton).click();
      // 接受成功 → 待处理清零（空态文案是被测行为）。
      await expect(guestPage.getByText("没有待处理的邀请。")).toBeVisible();

      // 新建团队项目，并建两张卡：一张归 owner，一张指派给 guest。
      await page.goto(`/space/${teamSlug}/projects/new`);
      await page.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
      await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
      await expect(
        page.getByRole("heading", { name: projectName, level: 1 }),
      ).toBeVisible({ timeout: 30_000 });

      await createTeamTask(ownerTask);
      await createTeamTask(orphanTask, guestName);

      // 移除 guest：其负责的任务按既有语义置空为「未指派」，是 UI 上唯一
      // 能产出未指派任务的真实路径（新建弹窗的责任人只能选团队成员）。
      await page.goto(`/space/${teamSlug}/settings`);
      const guestRow = page.getByRole("row", { name: new RegExp(guestName) });
      await guestRow.getByTestId(TEST_IDS.teams.memberRemoveButton).click();

      const confirmDialog = page.getByRole("dialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog
        .getByTestId(TEST_IDS.teams.memberRemoveConfirmButton)
        .click();
      await expect(page.getByText("已移除成员")).toBeVisible();
    } finally {
      await guestContext.close();
    }

    // 团队看板：默认「全部任务」= 两张卡；被移除成员的任务显示未指派 tag。
    await page.goto(`/space/${teamSlug}/tasks`);
    const todo = page.getByTestId(TEST_IDS.kanban.spaceColumnTodo);
    await expect(page.getByText("当前筛选：全部项目 · 2 个未完成任务")).toBeVisible();
    await expect(todo.getByText(ownerTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(orphanTask, { exact: true })).toBeVisible();
    await expect(
      todo.getByLabel(orphanTask, { exact: true }).getByText("未指派", {
        exact: true,
      }),
    ).toBeVisible();

    // 切「未指派」：只剩被置空的那张卡，URL 写入契约参数。
    const filterBar = page.getByTestId(TEST_IDS.kanban.assigneeFilter);
    await filterBar.getByText("未指派", { exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/space/${teamSlug}/tasks\\?assignee=unassigned$`),
    );
    await expect(page.getByText("当前筛选：全部项目 · 1 个未完成任务")).toBeVisible();
    await expect(todo.getByText(orphanTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(ownerTask, { exact: true })).toHaveCount(0);

    // 刷新还原同一筛选视图（RSC 按 query 重新过滤）。
    await page.reload();
    await expect(page.getByText("当前筛选：全部项目 · 1 个未完成任务")).toBeVisible();
    await expect(todo.getByText(orphanTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(ownerTask, { exact: true })).toHaveCount(0);

    // 切回「全部任务」：URL 回到干净地址，两张卡都回来。
    await filterBar.getByText("全部任务", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/space/${teamSlug}/tasks$`));
    await expect(page.getByText("当前筛选：全部项目 · 2 个未完成任务")).toBeVisible();
    await expect(todo.getByText(ownerTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(orphanTask, { exact: true })).toBeVisible();
  });

  test("移动端状态按钮与 done 查看更早展开可逆", async ({ page }) => {
    const username = uniqueUsername("e2e_kbm");
    const projectName = uniqueLabel("E2E kb mobile");
    const taskTitle = uniqueLabel("E2E kb mobile task");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: taskTitle });

    // 375px：看板单列堆叠，拖拽关闭，卡内状态按钮可达。
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/space/personal/tasks");

    const todo = page.getByTestId(TEST_IDS.kanban.spaceColumnTodo);
    const inProgress = page.getByTestId(TEST_IDS.kanban.spaceColumnInProgress);
    const done = page.getByTestId(TEST_IDS.kanban.spaceColumnDone);

    await expect(todo.getByText(taskTitle, { exact: true })).toBeVisible();

    // 待办 → 进行中（按钮位于卡片内，跟随 router.refresh 重渲染）。
    await todo
      .getByTestId(TEST_IDS.tasks.cardStatusButton("in_progress"))
      .click();
    await expect(
      inProgress.getByText(taskTitle, { exact: true }),
    ).toBeVisible();
    await expect(todo.getByText("暂无任务")).toBeVisible();

    // 进行中 → 已完成。
    await inProgress
      .getByTestId(TEST_IDS.tasks.cardStatusButton("done"))
      .click();
    await expect(done.getByText(taskTitle, { exact: true })).toBeVisible();
    await expect(inProgress.getByText("暂无任务")).toBeVisible();

    // 把完成时间挪到 7 天窗口外，构造「更早」块（UI 无改完成时间的入口，
    // 只能直接改 e2e 库的 updated_at；其它状态字段不动）。
    await ageTaskUpdatedAt(taskTitle, 10);
    await page.reload();

    await expect(done.getByText(taskTitle, { exact: true })).toHaveCount(0);
    // 「查看更早 N 项」为计数文案，计数是被测行为。
    const expander = done.getByRole("button", {
      name: /查看更早 1 项已完成/,
    });
    await expect(expander).toBeVisible();

    // 原地展开：更早的卡出现，链接变「收起」。
    await expander.click();
    await expect(done.getByText(taskTitle, { exact: true })).toBeVisible();
    const collapse = done.getByRole("button", {
      name: /已显示全部 1 项 · 收起/,
    });
    await expect(collapse).toBeVisible();

    // 收起：恢复近 7 天视图，链接复原（可逆）。
    await collapse.click();
    await expect(done.getByText(taskTitle, { exact: true })).toHaveCount(0);
    await expect(
      done.getByRole("button", { name: /查看更早 1 项已完成/ }),
    ).toBeVisible();
  });
});

/**
 * 把指定标题任务的 `updated_at` 前移 N 天。
 *
 * done 列的「近 7 天」窗口按 `updated_at` 计算，而任何 UI 操作都会把该列
 * 刷成当前时间；e2e 需要一张「7 天前完成」的卡来验证「查看更早」，因此
 * 仅在 e2e 库上做这一处窄定位更新（标题全局唯一，行数保护见 assert）。
 */
async function ageTaskUpdatedAt(title: string, days: number): Promise<void> {
  assertE2EDatabaseUrl(E2E_DATABASE_URL);

  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const updated = await client`
      UPDATE tasks
      SET updated_at = now() - ${`${days} days`}::interval
      WHERE title = ${title}
      RETURNING id
    `;
    expect(updated.length).toBe(1);
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * 统计带（统计即筛选）：点击已逾期 chip 写入 `?overdue=1`，看板只剩逾期卡；
 * 激活 chip 以 aria-pressed 标记，再点取消回到干净地址。日期取远过去 /
 * 远未来，不依赖真实时钟。
 */
test.describe("flow 6: 看板统计带", () => {
  test("点击已逾期 chip 即筛选：URL 契约、只剩逾期卡、aria-pressed 激活", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_kstat");
    const projectName = uniqueLabel("E2E kb stat");
    const overdueTask = uniqueLabel("E2E kb stat overdue");
    const futureTask = uniqueLabel("E2E kb stat future");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: overdueTask, dueDate: "2020-01-01" });
    await createPersonalTask(page, { title: futureTask, dueDate: "2099-01-01" });

    await page.goto("/space/personal/tasks");

    const overdueChip = page.locator('[data-filter="overdue"]');
    await expect(overdueChip).toHaveAttribute("aria-pressed", "false");

    // 点击即筛选：URL 写入契约参数，激活态翻转。
    await overdueChip.click();
    await expect(page).toHaveURL(/\/space\/personal\/tasks\?overdue=1$/);
    await expect(overdueChip).toHaveAttribute("aria-pressed", "true");

    // 看板只剩逾期卡，未来到期卡被筛掉。
    const todo = page.getByTestId(TEST_IDS.kanban.spaceColumnTodo);
    await expect(todo.getByText(overdueTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(futureTask, { exact: true })).toHaveCount(0);

    // 刷新还原同一筛选视图（RSC 按 query 重新过滤）。
    await page.reload();
    await expect(todo.getByText(overdueTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(futureTask, { exact: true })).toHaveCount(0);

    // 再点取消：参数删除，URL 回到干净地址，两张卡都回来。
    await overdueChip.click();
    await expect(page).toHaveURL(/\/space\/personal\/tasks$/);
    await expect(overdueChip).toHaveAttribute("aria-pressed", "false");
    await expect(todo.getByText(overdueTask, { exact: true })).toBeVisible();
    await expect(todo.getByText(futureTask, { exact: true })).toBeVisible();
  });

  test("激活已逾期视角后切换项目，统计参数保留", async ({ page }) => {
    const username = uniqueUsername("e2e_kstat2");
    const projectName = uniqueLabel("E2E kb stat keep");
    const overdueTask = uniqueLabel("E2E kb stat keep overdue");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: overdueTask, dueDate: "2020-01-01" });

    await page.goto("/space/personal/tasks");
    const overdueChip = page.locator('[data-filter="overdue"]');
    await overdueChip.click();
    await expect(page).toHaveURL(/\/space\/personal\/tasks\?overdue=1$/);

    // 视角内细化：切到项目 A，已逾期视角必须跟着走（URL 仍带 overdue=1，chip 仍激活）。
    await page.getByTestId(TEST_IDS.kanban.projectFilter).click();
    await page
      .getByRole("option", { name: new RegExp(`^${projectName}`) })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`project=${personalProjectSlug(projectName)}`),
    );
    await expect(page).toHaveURL(/overdue=1/);
    await expect(overdueChip).toHaveAttribute("aria-pressed", "true");
  });
});

/**
 * 任务页双视图（看板 / 列表，TasksViewTabs + SpaceTaskTable）。
 *
 * 覆盖（对照实现计划的 Task 5）：
 * 1. 默认看板且 URL 无 view；2. tab 切列表 + ?view=list 入 URL + Tab 遍历
 * 不落入看板面板（inert）；3. ?view=list 深链接刷新首屏即列表；
 * 4. 统计 chip 导航保留 view=list（view 贯通）；
 * 5. 窗口外已完成（updatedAt > 7 天）入列表、看板 done 列（未展开）不可见；
 * 6. 团队：member 会话可见「新建任务」并经弹窗创建成功出现在列表。
 */
test.describe("flow 6: 任务页双视图", () => {
  test("个人任务页：tab 切换、深链接刷新、统计保留 view、更早已完成入列表", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_kv");
    const projectName = uniqueLabel("E2E kv project");
    const todoTask = uniqueLabel("E2E kv todo task");
    const doneTask = uniqueLabel("E2E kv done task");

    await registerUser(page, username);
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: doneTask });

    // 预置一张近 7 天完成的卡：卡内状态按钮仅移动端布局渲染
    // （`min-[861px]:hidden`），借 375px 视口走真实按钮路径（todo 列此刻
    // 只有这张卡，无需卡片级定位）。
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/space/personal/tasks");
    await page
      .getByTestId(TEST_IDS.kanban.spaceColumnTodo)
      .getByTestId(TEST_IDS.tasks.cardStatusButton("done"))
      .click();
    const done = page.getByTestId(TEST_IDS.kanban.spaceColumnDone);
    await expect(done.getByText(doneTask, { exact: true })).toBeVisible();

    // 回到桌面视口，补建第二张卡（后续用例不再点卡内按钮）。
    await page.setViewportSize({ width: 1280, height: 720 });
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, { title: todoTask });

    // 1. 默认看板：面板可见，URL 无 view。
    await page.goto("/space/personal/tasks");
    await expect(page.getByTestId(TEST_IDS.kanban.viewPanelBoard)).toBeVisible();
    await expect(page).toHaveURL(/\/space\/personal\/tasks$/);

    // 2. 切列表：表格可见、?view=list 入 URL；Tab 遍历不落入看板面板。
    await page.getByTestId(TEST_IDS.kanban.viewTabList).click();
    const table = page.getByTestId(TEST_IDS.kanban.taskTable);
    await expect(table).toBeVisible();
    await expect(page).toHaveURL(/\/space\/personal\/tasks\?view=list$/);

    await page.getByTestId(TEST_IDS.kanban.viewTabList).focus();
    await page.keyboard.press("Tab");
    const focusInside = (testid: string) =>
      page.evaluate(
        (panelTestid) =>
          !!document.activeElement?.closest(
            `[data-testid="${panelTestid}"]`,
          ),
        testid,
      );
    expect(await focusInside(TEST_IDS.kanban.viewPanelBoard)).toBe(false);
    expect(await focusInside(TEST_IDS.kanban.viewPanelList)).toBe(true);

    // 3. 深链接：直开 ?view=list，刷新后首屏仍是列表。
    await page.goto("/space/personal/tasks?view=list");
    await expect(page.getByTestId(TEST_IDS.kanban.taskTable)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(TEST_IDS.kanban.taskTable)).toBeVisible();
    await expect(table.getByText(todoTask, { exact: true })).toBeVisible();

    // 4. 统计 chip 导航保留 view：URL 同时含筛选参数与 view=list。
    await page.locator('[data-filter="status:todo"]').click();
    await expect(page).toHaveURL(
      /\/space\/personal\/tasks\?status=todo&view=list$/,
    );
    await expect(page.getByTestId(TEST_IDS.kanban.taskTable)).toBeVisible();

    // 5. 窗口外已完成：列表可见，看板 done 列（未展开）不可见。
    await page.goto("/space/personal/tasks?view=list");
    await ageTaskUpdatedAt(doneTask, 10);
    await page.reload();
    await expect(table.getByText(doneTask, { exact: true })).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.kanban.spaceColumnDone).getByText(doneTask, { exact: true })).toHaveCount(0);
    await expect(table.getByText(todoTask, { exact: true })).toBeVisible();
  });

  test("团队任务页：member 会话可见新建任务，经弹窗创建成功出现在列表", async ({
    page,
    browser,
  }) => {
    const ownerName = uniqueUsername("e2e_kvto");
    const memberName = uniqueUsername("e2e_kvtm");
    const teamName = uniqueLabel("E2E kvt team");
    const projectName = uniqueLabel("E2E kvt project");
    const taskTitle = uniqueLabel("E2E kvt task");

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

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    try {
      // 邀请第二账号入队（member 角色，验证新建任务入口不被权限门槛挡住）。
      await registerUser(memberPage, memberName);
      await memberPage.goto("/invites");
      const uid = (
        await memberPage.getByTestId(TEST_IDS.teams.accountUid).innerText()
      ).trim();

      await page
        .getByTestId(TEST_IDS.teams.inviteUidInput)
        .fill(uid.replace(/^doing_/, ""));
      await page.getByTestId(TEST_IDS.teams.inviteSendButton).click();
      await expect(
        page.getByTestId(TEST_IDS.teams.invitePendingHeading),
      ).toContainText("1");

      await memberPage.goto("/invites");
      await memberPage.getByTestId(TEST_IDS.teams.inviteAcceptButton).click();
      await expect(memberPage.getByText("没有待处理的邀请。")).toBeVisible();

      // owner 建一个团队项目，保证弹窗的项目下拉有可选项。
      await page.goto(`/space/${teamSlug}/projects/new`);
      await page
        .getByTestId(TEST_IDS.projects.teamProjectNameInput)
        .fill(projectName);
      await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
      await expect(
        page.getByRole("heading", { name: projectName, level: 1 }),
      ).toBeVisible({ timeout: 30_000 });

      // member 会话进团队任务页：新建任务可见（新建项目则仅 owner 可见）。
      await memberPage.goto(`/space/${teamSlug}/tasks`);
      const newTaskButton = memberPage.getByRole("button", {
        name: "新建任务",
        exact: true,
      });
      await expect(newTaskButton).toBeVisible();

      // 经弹窗创建任务（项目 / 责任人走默认值：唯一项目 / 自己）。
      await newTaskButton.click();
      const dialog = memberPage.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // 等弹窗动效与初始值同步完成后再填写。
      await memberPage.waitForTimeout(500);
      await dialog.getByTestId(TEST_IDS.tasks.titleInput).fill(taskTitle);
      await dialog.getByTestId(TEST_IDS.tasks.createSubmitButton).click();
      await expect(dialog).toBeHidden();

      // 成功后出现在列表视图（router.refresh 已带回新数据）。
      await memberPage.getByTestId(TEST_IDS.kanban.viewTabList).click();
      await expect(
        memberPage
          .getByTestId(TEST_IDS.kanban.taskTable)
          .getByText(taskTitle, { exact: true }),
      ).toBeVisible();
    } finally {
      await memberContext.close();
    }
  });
});
