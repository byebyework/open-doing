import { expect, test, type Page } from "@playwright/test";

import { TEST_IDS } from "../utils/testids";
import {
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  registerUser,
  shanghaiToday,
  uniqueLabel,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 8：空间级 Analysis（v1.1 M5，`/space/{spaceRef}/analysis`）。
 *
 * 覆盖（对照实现计划的 Task 5）：
 * 1. 个人分析页统计行四个 label + 四个区块标题，默认「近 30 天」高亮；
 * 2. 切「近 7 天」写回 URL，趋势区块按新范围渲染，统计行文案不变
 *    （统计卡恒为当前快照，range 只作用于趋势区块）；用一张 10 天前到期
 *    的未完成任务让「当前逾期」= 1，证明统计行没有随 range 重过滤；
 * 3. 非法 `?range=abc` 宽容回退「近 30 天」（沿 M4 month 同款语义）；
 * 4. 团队成员访问团队分析页：经 UI 建团队 + 项目 + 任务后，统计行
 *    「本周完成」≥1、吞吐出现非零柱、项目健康度与成员负载分布有真实行；
 * 5. 非成员访问团队分析页 404（不泄露团队存在性）。
 *
 * 僵尸任务只断言区块标题与空态：造一张 `in_progress` 且超过 14 天未更新的
 * 任务必须改 `updated_at`，UI 无法低成本完成，故不为其单独造 fixture
 * （该口径由 `features/analysis/service.test.ts` 覆盖）。
 */

// 团队用例要建第二个账号（非成员 404 对照），比其它流多一个浏览器上下文。
test.describe.configure({ timeout: 120_000 });

/** 个人空间统计卡的四个 label（顺序即渲染顺序）。 */
const PERSONAL_STAT_LABELS = [
  "进行中",
  "本月完成",
  "当前逾期",
  "按时率",
] as const;

/** 个人空间四个区块标题（顺序即渲染顺序）。 */
const PERSONAL_SECTION_TITLES = [
  "完成趋势",
  "新增 vs 完成",
  "未来截止分布",
  "项目对比",
] as const;

/** 团队空间四个区块标题（顺序即渲染顺序）。 */
const TEAM_SECTION_TITLES = [
  "吞吐",
  "成员负载分布",
  "项目健康度",
  "僵尸任务",
] as const;

test.describe("flow 8: 空间级 Analysis", () => {
  test("个人分析页渲染统计行与四个区块，默认近 30 天", async ({ page }) => {
    await registerUser(page, uniqueUsername("e2e_an1"));

    await page.goto("/space/personal/analysis");

    await expect(
      page.getByRole("heading", { name: "分析", level: 1 }),
    ).toBeVisible();

    // 统计行四张卡；新账号无任务，数值为 0 / —（按时率分母为 0）。
    for (const label of PERSONAL_STAT_LABELS) {
      await expect(statCard(page, label)).toBeVisible();
    }
    await expectStatValue(page, "进行中", "0");
    await expectStatValue(page, "本月完成", "0");
    await expectStatValue(page, "当前逾期", "0");
    await expectStatValue(page, "按时率", "—");
    // 按时率口径恒为近 30 天（与 range 无关）。
    await expect(statCard(page, "按时率")).toContainText(
      "近 30 天 · 暂无有截止日期的已完成",
    );

    // 四个区块标题都是真实 h2。
    for (const title of PERSONAL_SECTION_TITLES) {
      await expect(
        page.getByRole("heading", { name: title, level: 2 }),
      ).toBeVisible();
    }

    // 默认「近 30 天」高亮，另两个不高亮；趋势说明同步为 30 天 / 按日。
    await expect(
      page.getByTestId(TEST_IDS.analysis.range(30)),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId(TEST_IDS.analysis.range(7)),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByTestId(TEST_IDS.analysis.range(90)),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText(/近 30 天 · 按日 · 共完成 0 项/),
    ).toBeVisible();
  });

  test("切换近 7 天写回 URL 且统计行文案不变", async ({ page }) => {
    const username = uniqueUsername("e2e_an2");
    const projectName = uniqueLabel("E2E an overdue project");
    const taskTitle = uniqueLabel("E2E an overdue task");

    await registerUser(page, username);
    // 10 天前到期且未完成：落在近 30 天窗口内、近 7 天窗口外。
    // 若统计行被错误地按 range 过滤，「当前逾期」会从 1 变 0，本用例即失败。
    await createPersonalProject(page, projectName);
    await openPersonalProject(page, projectName);
    await createPersonalTask(page, {
      title: taskTitle,
      dueDate: shiftDate(shanghaiToday(), -10),
    });

    await page.goto("/space/personal/analysis");
    await expectStatValue(page, "当前逾期", "1");

    // 切换前抓取统计行整段文案（快照口径下不随 range 变化）。
    const statsRow = statCard(page, "进行中").locator("..");
    const statsBefore = await statsRow.textContent();

    await page.getByTestId(TEST_IDS.analysis.range(7)).click();

    await expect(page).toHaveURL(/\/space\/personal\/analysis\?range=7$/);
    await expect(
      page.getByTestId(TEST_IDS.analysis.range(7)),
    ).toHaveAttribute("aria-pressed", "true");

    // 趋势区块确实按新范围重取（说明文案 30 天 → 7 天）。
    await expect(
      page.getByText(/近 7 天 · 按日 · 共完成 0 项/),
    ).toBeVisible();

    // 统计行文案逐字不变：range 只影响趋势区块。
    expect(
      await statCard(page, "进行中").locator("..").textContent(),
    ).toBe(statsBefore);
    // 「当前逾期」仍是 1（10 天前到期的任务没有被 7 天窗口过滤掉）。
    await expectStatValue(page, "当前逾期", "1");
    await expectStatValue(page, "按时率", "—");
  });

  test("非法 range 宽容回退近 30 天", async ({ page }) => {
    await registerUser(page, uniqueUsername("e2e_an3"));

    await page.goto("/space/personal/analysis?range=abc");

    // 不 500、不报错：静默回退默认范围。
    await expect(
      page.getByRole("heading", { name: "分析", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByTestId(TEST_IDS.analysis.range(30)),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId(TEST_IDS.analysis.range(7)),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText(/近 30 天 · 按日 · 共完成 0 项/),
    ).toBeVisible();
  });

  test("团队成员访问团队分析页，四区块在真实数据上渲染", async ({ page }) => {
    const ownerName = uniqueUsername("e2e_an4");
    const teamName = uniqueLabel("E2E an team");
    const projectName = uniqueLabel("E2E an project");
    const doneTaskTitle = uniqueLabel("E2E an done task");
    const activeTaskTitle = uniqueLabel("E2E an active task");
    const today = shanghaiToday();

    await registerUser(page, ownerName);
    const teamSlug = await createTeam(page, teamName);

    // 团队项目：一张昨天截止的任务稍后置为已完成（计入本周完成 / 吞吐 /
    // 项目健康度），一张未来截止的任务置为进行中（计入成员负载）。
    await page.goto(`/space/${teamSlug}/projects/new`);
    await page.getByTestId(TEST_IDS.projects.teamProjectNameInput).fill(projectName);
    await page.getByTestId(TEST_IDS.projects.teamProjectSubmitButton).click();
    await expect(
      page.getByRole("heading", { name: projectName, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    await createTeamTask(page, {
      title: doneTaskTitle,
      dueDate: shiftDate(today, -1),
    });
    await createTeamTask(page, {
      title: activeTaskTitle,
      dueDate: shiftDate(today, 3),
    });

    // 窄屏卡内状态按钮（flow 6 同款路径，不用不稳定的 dnd 拖拽）。
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/space/${teamSlug}/kanban`);

    const todo = page.getByTestId(TEST_IDS.kanban.spaceColumnTodo);
    const inProgress = page.getByTestId(TEST_IDS.kanban.spaceColumnInProgress);
    const done = page.getByTestId(TEST_IDS.kanban.spaceColumnDone);
    await expect(todo.getByText(doneTaskTitle, { exact: true })).toBeVisible();
    await expect(
      todo.getByText(activeTaskTitle, { exact: true }),
    ).toBeVisible();

    await cardStatusButton(page, doneTaskTitle, "done").click();
    await expect(done.getByText(doneTaskTitle, { exact: true })).toBeVisible();
    await cardStatusButton(page, activeTaskTitle, "in_progress").click();
    await expect(
      inProgress.getByText(activeTaskTitle, { exact: true }),
    ).toBeVisible();

    // 回到桌面视口，与分析页其它团队用例保持一致。
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/space/${teamSlug}/analysis`);

    await expect(
      page.getByRole("heading", { name: "分析", level: 1 }),
    ).toBeVisible();
    for (const title of TEAM_SECTION_TITLES) {
      await expect(
        page.getByRole("heading", { name: title, level: 2 }),
      ).toBeVisible();
    }

    // 统计行：「本周完成」计数来自今天完成的那张任务。
    await expectStatValue(page, "本周完成", "1");
    // 昨天截止的任务已完成，未来截止的任务未到期：没有逾期。
    await expectStatValue(page, "当前逾期", "0");

    // 吞吐：今天所在桶非零（柱高 > 0 时才会带「完成 1」的悬停文案）。
    const throughput = sectionByHeading(page, "吞吐");
    await expect(
      throughput.getByText("近 30 天 · 按日 · 共完成 1 项"),
    ).toBeVisible();
    await expect(throughput.getByTitle(/今天 .* · 完成 1/)).toBeVisible();

    // 项目健康度：该项目行出现，进度条按任务数分母渲染（1/2 完成 + 进行中）。
    const health = sectionByHeading(page, "项目健康度");
    await expect(health.getByText(projectName, { exact: true })).toBeVisible();
    await expect(health.getByText("2 个任务 · 1 已完成")).toBeVisible();
    await expect(health.getByText("75%", { exact: true })).toBeVisible();
    // 进度条填充（块级 span）宽度 > 0：证明进度不是空条。
    const progressFill = health.locator("span.h-full.rounded-full");
    await expect(progressFill).toBeVisible();
    await expect
      .poll(async () => (await progressFill.boundingBox())?.width ?? 0)
      .toBeGreaterThan(0);

    // 成员负载分布：owner 行显示进行中计数（1 张进行中任务）。
    const memberLoad = sectionByHeading(page, "成员负载分布");
    await expect(
      memberLoad.getByTitle(`${ownerName} · 进行中 1 项`),
    ).toBeVisible();

    // 没有进行中且 14 天未更新的任务：僵尸任务区块为空态。
    // （老 `updated_at` 无法经 UI 低成本构造，不为其造专用 fixture。）
    await expect(page.getByText("暂无僵尸任务。")).toBeVisible();
  });

  test("非成员访问团队分析页返回 404", async ({ page, browser }) => {
    const teamName = uniqueLabel("E2E an private team");

    await registerUser(page, uniqueUsername("e2e_an5o"));
    const teamSlug = await createTeam(page, teamName);

    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();

    try {
      // 未受邀的账号访问团队分析页：404 页，不泄露团队存在性。
      await registerUser(outsiderPage, uniqueUsername("e2e_an5x"));
      const response = await outsiderPage.goto(
        `/space/${teamSlug}/analysis`,
      );
      expect(response?.status()).toBe(404);
      await expect(
        outsiderPage.getByTestId(TEST_IDS.misc.notFoundMessage),
      ).toBeVisible();
    } finally {
      await outsiderContext.close();
    }

    // 对照组：owner（团队成员）能正常打开同一地址。
    await page.goto(`/space/${teamSlug}/analysis`);
    await expect(
      page.getByRole("heading", { name: "分析", level: 1 }),
    ).toBeVisible();
  });
});

/** 统计卡根节点：以卡内唯一的 label 文本锚定卡片容器。 */
function statCard(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..");
}

/** 区块容器：h2 标题的父级卡头再上一级即 `<section>`。 */
function sectionByHeading(page: Page, title: string) {
  return page.getByRole("heading", { name: title, level: 2 }).locator("../..");
}

/**
 * 窄屏看板卡片内的状态按钮：先按卡片 aria-label（任务标题）定位卡片，
 * 再进到卡片根节点找对应状态按钮（testid 与文案无关）。
 */
function cardStatusButton(
  page: Page,
  cardTitle: string,
  status: "todo" | "in_progress" | "done",
) {
  return page
    .getByLabel(cardTitle, { exact: true })
    .locator("..")
    .getByTestId(TEST_IDS.tasks.cardStatusButton(status));
}

/**
 * 在团队项目页经「新建任务」弹窗创建任务。
 *
 * 沿 flow 6 的团队建任务路径；弹窗的截止日期是原生 date input，可直接
 * `fill("YYYY-MM-DD")`（个人任务 helper 同款）。
 */
async function createTeamTask(
  page: Page,
  input: { title: string; dueDate?: string },
): Promise<void> {
  await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 等弹窗 afterOpenChange 的 resetFields 完成后再填写。
  await page.waitForTimeout(500);
  await dialog.getByTestId(TEST_IDS.tasks.titleInput).fill(input.title);
  if (input.dueDate) {
    await dialog.getByTestId(TEST_IDS.tasks.dueDateInput).fill(input.dueDate);
  }
  await dialog.getByTestId(TEST_IDS.tasks.createSubmitButton).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("link", { name: input.title, exact: true }),
  ).toBeVisible();
}

/**
 * 断言统计卡数值：在卡片范围内按精确文本定位，不依赖子节点顺序。
 *
 * label 与 hint 都是固定长文案，卡内唯一能精确等于数值的节点就是数值格。
 */
async function expectStatValue(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await expect(
    statCard(page, label).getByText(value, { exact: true }),
  ).toBeVisible();
}

/** `YYYY-MM-DD` 加减天数（UTC 毫秒算术，与 `lib/today` 同口径）。 */
function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year!, month! - 1, day!) + days * 86_400_000,
  );

  return shifted.toISOString().slice(0, 10);
}

/**
 * 通过 `/teams/new` 建团队并返回 slug。
 *
 * 沿 flow 6 / flow 7 的建队路径；创建成功后应用跳转 `/space/{slug}/settings`。
 */
async function createTeam(page: Page, teamName: string): Promise<string> {
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

  return teamSlug;
}
