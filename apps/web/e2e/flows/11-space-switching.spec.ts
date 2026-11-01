import { expect, test, type Page } from "@playwright/test";

import { registerUser, uniqueLabel, uniqueUsername } from "../utils/flows";

/**
 * 关键流 11：空间切换器 + 移动端 Drawer 导航（v1.1 S4）。
 *
 * 覆盖：
 * 1. 桌面：无团队时切换器显示「个人空间」且个人项选中；建团后经切换器
 *    进入团队 Dashboard（团队名 + 团队项选中），再切回个人空间；
 * 2. 保留字：团队名为 "Personal" 时 slug 不占用 `personal`，
 *    `/space/personal/dashboard` 仍是个人 Dashboard（Task 2 行为）；
 * 3. 移动端（375px）：汉堡按钮打开 Drawer（与桌面同源导航树），
 *    经 Drawer 内 Kanban 项跳转并断言页面渲染，随后可关闭 Drawer。
 *
 * 切换器选择器对照 `SpaceSwitcher.tsx`：aside 内唯一按钮为触发器，
 * antd Dropdown 菜单渲染在 body portal 中，按 menuitem 文本定位；
 * 选中态是 antd 菜单的 `ant-dropdown-menu-item-selected` 类。
 */

// 建团 + 多次跨路由导航在冷启动 dev server 上可能超过默认 60s。
test.describe.configure({ timeout: 120_000 });

/** 侧栏空间切换器触发按钮（aside 内唯一的 button）。 */
function switcherTrigger(page: Page) {
  return page.locator("aside").getByRole("button");
}

/** 注册后从 /teams/new 建团，落在团队设置页并返回团队 slug。 */
async function createTeam(page: Page, teamName: string): Promise<string> {
  await page.goto("/teams/new");
  await expect(
    page.getByRole("heading", { name: "创建团队", level: 1 }),
  ).toBeVisible();

  await page.getByLabel("团队名称").fill(teamName);
  await page.getByRole("button", { name: "创建团队" }).click();
  await expect(page).toHaveURL(/\/space\/[^/]+\/settings$/, {
    timeout: 30_000,
  });

  const slug = decodeURIComponent(
    new URL(page.url()).pathname.split("/")[2] ?? "",
  );
  expect(slug).not.toBe("");
  return slug;
}

/** 打开切换器并返回下拉菜单中指定文本的菜单项。 */
async function openSwitcherAndGetItem(page: Page, name: string | RegExp) {
  await switcherTrigger(page).click();
  const item = page.getByRole("menuitem", { name });
  await expect(item).toBeVisible();
  return item;
}

test.describe("flow 11: 空间切换", () => {
  test("桌面：个人 ↔ 团队切换，选中态跟随路由", async ({ page }) => {
    const username = uniqueUsername("e2e_spc");
    const teamName = uniqueLabel("E2E space team");

    // 注册后无团队：切换器显示「个人空间」，个人项选中。
    await registerUser(page, username);
    await expect(switcherTrigger(page)).toHaveText(/个人空间/);

    const personalItem = await openSwitcherAndGetItem(page, "个人空间");
    await expect(personalItem).toHaveClass(
      /ant-dropdown-menu-item-selected/,
    );
    // 无团队时不渲染「我的团队」分组。
    await expect(page.getByText("我的团队", { exact: true })).toHaveCount(0);

    // 经 /teams/new 建团（落团队设置页）：当前空间即新团队。
    const teamSlug = await createTeam(page, teamName);
    await expect(switcherTrigger(page)).toHaveText(teamName);

    // 切换器菜单「我的团队」分组下出现该团队，且为选中态。
    const teamItem = await openSwitcherAndGetItem(page, teamName);
    await expect(page.getByText("我的团队", { exact: true })).toBeVisible();
    await expect(teamItem).toHaveClass(/ant-dropdown-menu-item-selected/);

    // 点击团队项 → 团队 Dashboard，切换器与选中态同步。
    await teamItem.click();
    await expect(page).toHaveURL(
      new RegExp(`/space/${teamSlug}/dashboard$`),
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(switcherTrigger(page)).toHaveText(teamName);

    // 再经切换器回个人空间 → URL 与选中态回到 personal。
    const backToPersonal = await openSwitcherAndGetItem(page, "个人空间");
    await backToPersonal.click();
    await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(switcherTrigger(page)).toHaveText(/个人空间/);

    const personalSelected = await openSwitcherAndGetItem(page, "个人空间");
    await expect(personalSelected).toHaveClass(
      /ant-dropdown-menu-item-selected/,
    );
  });

  test("保留字：名为 Personal 的团队不占用 /space/personal", async ({
    page,
  }) => {
    const username = uniqueUsername("e2e_rsv");

    await registerUser(page, username);

    // 经 UI 建一个名为 “Personal” 的团队；Task 2 的保留字规则应跳过
    // 根 slug `personal` 并落到计数后缀（干净 e2e 库中为 `personal-2`）。
    const teamSlug = await createTeam(page, "Personal");
    expect(teamSlug).toMatch(/^personal(-\d+)?$/);
    expect(teamSlug).not.toBe("personal");

    // `/space/personal/dashboard` 仍是个人 Dashboard（200 + 标题，非 404）。
    const response = await page.goto("/space/personal/dashboard");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(switcherTrigger(page)).toHaveText(/个人空间/);

    // 团队本身仍存在：切换器里能看到名为 Personal 的团队项。
    await openSwitcherAndGetItem(page, "Personal");
  });
});

test.describe("flow 11: 移动端 Drawer 导航", () => {
  // 375×667：侧栏隐藏（<861px），汉堡按钮接管导航入口。
  test.use({ viewport: { width: 375, height: 667 } });

  test("汉堡打开 Drawer，经模块项跳 Kanban 并可关闭", async ({ page }) => {
    const username = uniqueUsername("e2e_mob");
    const hamburger = page.getByRole("button", { name: "打开导航" });

    await registerUser(page, username);

    // 桌面侧栏在 375px 下隐藏，汉堡按钮出现。
    await expect(page.locator("aside")).toBeHidden();
    await expect(hamburger).toBeVisible();
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");

    // 打开 Drawer：与桌面同源导航树（切换器 + 五模块 + 账号分组）。
    await hamburger.click();
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: /个人空间/ }),
    ).toBeVisible();
    for (const label of [
      "Dashboard",
      "Kanban",
      "Calendar",
      "Analysis",
      "设置",
    ]) {
      await expect(
        drawer.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(
      drawer.getByRole("link", { name: "待处理邀请" }),
    ).toBeVisible();

    // 经 Drawer 内 Kanban 跳转 → URL 与页面真实渲染；路由变化自动收起 Drawer。
    await drawer.getByRole("link", { name: "Kanban", exact: true }).click();
    await expect(page).toHaveURL(/\/space\/personal\/kanban$/, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Kanban", level: 1 }),
    ).toBeVisible();
    await expect(drawer).toBeHidden();

    // 再次打开并用 Drawer 关闭按钮收起（zhCN 下 close 按钮可访问名为「关闭」）。
    await hamburger.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "关闭" }).click();
    await expect(drawer).toBeHidden();
  });
});
