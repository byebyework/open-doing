import { expect, test, type Page } from "@playwright/test";

import { registerUser, uniqueLabel, uniqueUsername } from "../utils/flows";

/**
 * 关键流 8：空间级 Analysis（v1.1 M5，`/space/{spaceRef}/analysis`）。
 *
 * 覆盖（对照实现计划的 Task 5）：
 * 1. 个人分析页统计行动态 label + 四个区块标题，默认「近 30 天」高亮；
 * 2. 切「近 7 天」写回 URL，趋势区块按新范围渲染，统计行文案不变
 *    （统计卡恒为当前快照，range 只作用于趋势区块）；
 * 3. 非法 `?range=abc` 宽容回退「近 30 天」（沿 M4 month 同款语义）；
 * 4. 团队成员访问团队分析页，吞吐 / 成员负载分布 / 项目健康度 / 僵尸任务可见；
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
      page.getByRole("heading", { name: "Analysis", level: 1 }),
    ).toBeVisible();

    // 统计行四张卡；新账号无任务，数值为 0 / —（按时率分母为 0）。
    for (const label of PERSONAL_STAT_LABELS) {
      await expect(statCard(page, label)).toBeVisible();
    }
    await expect(statValue(page, "进行中")).toHaveText("0");
    await expect(statValue(page, "本月完成")).toHaveText("0");
    await expect(statValue(page, "当前逾期")).toHaveText("0");
    await expect(statValue(page, "按时率")).toHaveText("—");
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
      page.getByRole("button", { name: "近 30 天" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "近 7 天" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: "近 90 天" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText(/近 30 天 · 按日 · 共完成 0 项/),
    ).toBeVisible();
  });

  test("切换近 7 天写回 URL 且统计行文案不变", async ({ page }) => {
    await registerUser(page, uniqueUsername("e2e_an2"));

    await page.goto("/space/personal/analysis");

    // 切换前抓取统计行整段文案（快照口径下不随 range 变化）。
    const statsRow = statCard(page, "进行中").locator("..");
    const statsBefore = await statsRow.textContent();

    await page.getByRole("button", { name: "近 7 天" }).click();

    await expect(page).toHaveURL(/\/space\/personal\/analysis\?range=7$/);
    await expect(
      page.getByRole("button", { name: "近 7 天" }),
    ).toHaveAttribute("aria-pressed", "true");

    // 趋势区块确实按新范围重取（说明文案 30 天 → 7 天）。
    await expect(
      page.getByText(/近 7 天 · 按日 · 共完成 0 项/),
    ).toBeVisible();

    // 统计行文案逐字不变：range 只影响趋势区块。
    expect(
      await statCard(page, "进行中").locator("..").textContent(),
    ).toBe(statsBefore);
    await expect(statValue(page, "按时率")).toHaveText("—");
  });

  test("非法 range 宽容回退近 30 天", async ({ page }) => {
    await registerUser(page, uniqueUsername("e2e_an3"));

    await page.goto("/space/personal/analysis?range=abc");

    // 不 500、不报错：静默回退默认范围。
    await expect(
      page.getByRole("heading", { name: "Analysis", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "近 30 天" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "近 7 天" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText(/近 30 天 · 按日 · 共完成 0 项/),
    ).toBeVisible();
  });

  test("团队成员访问团队分析页，四个区块标题可见", async ({ page }) => {
    const teamName = uniqueLabel("E2E an team");

    await registerUser(page, uniqueUsername("e2e_an4"));
    const teamSlug = await createTeam(page, teamName);

    await page.goto(`/space/${teamSlug}/analysis`);

    await expect(
      page.getByRole("heading", { name: "Analysis", level: 1 }),
    ).toBeVisible();
    for (const title of TEAM_SECTION_TITLES) {
      await expect(
        page.getByRole("heading", { name: title, level: 2 }),
      ).toBeVisible();
    }

    // 新团队没有进行中且 14 天未更新的任务：僵尸任务区块为空态。
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
        outsiderPage.getByText("抱歉，你访问的页面不存在。"),
      ).toBeVisible();
    } finally {
      await outsiderContext.close();
    }

    // 对照组：owner（团队成员）能正常打开同一地址。
    await page.goto(`/space/${teamSlug}/analysis`);
    await expect(
      page.getByRole("heading", { name: "Analysis", level: 1 }),
    ).toBeVisible();
  });
});

/** 统计卡根节点：label 文本所在 div 的父级。 */
function statCard(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..");
}

/** 统计卡数值：根节点下第二个 div（标签、数值、说明三行）。 */
function statValue(page: Page, label: string) {
  return statCard(page, label).locator("div").nth(1);
}

/**
 * 通过 `/teams/new` 建团队并返回 slug。
 *
 * 沿 flow 6 / flow 7 的建队路径；创建成功后应用跳转 `/space/{slug}/settings`。
 */
async function createTeam(page: Page, teamName: string): Promise<string> {
  await page.goto("/teams/new");
  await page.getByLabel("团队名称").fill(teamName);
  await page.getByRole("button", { name: "创建团队" }).click();
  await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
    timeout: 30_000,
  });

  const teamSlug = decodeURIComponent(
    new URL(page.url()).pathname.split("/")[2] ?? "",
  );
  expect(teamSlug).not.toBe("");

  return teamSlug;
}
