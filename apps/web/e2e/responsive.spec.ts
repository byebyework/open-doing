import { expect, test, type Page } from "@playwright/test";

import {
  E2E_PASSWORD,
  createPersonalProject,
  createPersonalTask,
  openPersonalProject,
  openPersonalTask,
  registerUser,
  uniqueLabel,
  uniqueUsername,
} from "./utils/flows";

/**
 * 375px 响应式断言（Track X X-3 / Task 4）。
 *
 * 目标：全部已实现页面在 375×667 下 `document.documentElement.scrollWidth
 * <= window.innerWidth`，即页面本身不横向溢出。
 *
 * 豁免清单（均为仓库既有的「卡内横滚」模式：`min-w-0 overflow-x-auto`
 * 包裹 `min-w-[680px]` / `min-w-[860px]` 的表格，表格在卡片内横向滚动，
 * 页面本身不横向溢出；见
 * `features/personal/tasks/components/ProjectTaskTable.tsx`、
 * `features/tasks/components/TeamProjectTaskTable.tsx`）：
 *
 * - `/space/personal/projects/[slug]`（列表视图）：一张 `ProjectTaskTable`；
 * - `/space/[teamSlug]/projects/[projectSlug]`（列表视图）：一张
 *   `TeamProjectTaskTable`；
 * - `/space/[teamSlug]/settings`：一张 `MemberList` 成员表（同模式包裹）。
 *
 * v1.1 的 `/space/personal/dashboard` 改为统计卡 +「今天」任务列表，
 * 不再有表格，因此不再需要豁免。
 *
 * 除断言页面不溢出外，豁免路由还断言容器确实存在且可横向滚动——
 * 避免容器被误删后「恰好没有内容溢出」而让豁免悄悄过期。
 */

/** 卡内横滚豁免：容器选择器 + 该路由上应有的数量 + 理由。 */
interface InCardScrollExemption {
  /** 仓库既有模式：`min-w-0 overflow-x-auto` 的包裹层。 */
  container: string;
  /** 该路由上应有的包裹层数量。 */
  count: number;
  /** 豁免理由（与上方清单一致）。 */
  reason: string;
}

/** `/space/personal/projects/[slug]`：一张卡内横滚表格。 */
const PERSONAL_PROJECT_TABLE: InCardScrollExemption = {
  container: "div.overflow-x-auto",
  count: 1,
  reason:
    "ProjectTaskTable 在卡片内横向滚动（min-w-[680px] 表格 + overflow-x-auto），页面不横向溢出",
};

/** `/space/[teamSlug]/projects/[projectSlug]`：一张卡内横滚表格。 */
const TEAM_PROJECT_TABLE: InCardScrollExemption = {
  container: "div.overflow-x-auto",
  count: 1,
  reason:
    "TeamProjectTaskTable 在卡片内横向滚动（min-w-[860px] 表格 + overflow-x-auto），页面不横向溢出",
};

/** `/space/[teamSlug]/settings`：成员表（同一卡内横滚模式）。 */
const TEAM_SETTINGS_MEMBERS: InCardScrollExemption = {
  container: "div.overflow-x-auto",
  count: 1,
  reason:
    "MemberList 成员表在卡片内横向滚动（overflow-x-auto 包裹），页面不横向溢出",
};

/** 越界元素快照（仅用于失败信息，便于定位具体元素）。 */
interface OverflowOffender {
  tag: string;
  className: string;
  text: string;
  left: number;
  right: number;
}

/**
 * 测量当前视口的横向溢出。
 *
 * 只取有实际尺寸的元素；`left < -1` 同时覆盖向左越界（负边距 / 位移）。
 */
async function measureHorizontalOverflow(page: Page): Promise<{
  scrollWidth: number;
  innerWidth: number;
  offenders: OverflowOffender[];
}> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const offenders: OverflowOffender[] = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.width > 0 &&
          (rect.right > window.innerWidth + 1 || rect.left < -1),
      )
      .slice(0, 8)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        className:
          typeof element.className === "string"
            ? element.className.slice(0, 120)
            : "",
        text: (element.textContent ?? "").trim().slice(0, 40),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      }));

    return {
      scrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  });
}

/**
 * 断言页面在 375px 下不横向溢出，并校验豁免的卡内横滚容器仍然成立。
 *
 * 容器必须同时满足：数量符合预期、`overflow-x` 为 auto/scroll、内容确实
 * 宽于容器（说明豁免仍被真实使用，而不是无人使用的死代码）。
 */
async function assertNoPageOverflow(
  page: Page,
  label: string,
  exemptions: InCardScrollExemption[] = [],
): Promise<void> {
  // 等字体加载完成：字体替换会改变文本宽度，避免测量到中间态。
  await page.evaluate(() => document.fonts.ready);
  // 等两个渲染帧，让 antd 客户端组件（Badge / Segmented 等）完成布局。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  for (const exemption of exemptions) {
    const containers = page.locator(exemption.container);
    await expect(
      containers,
      `${label}：豁免容器 ${exemption.container} 数量应为 ${exemption.count}（${exemption.reason}）`,
    ).toHaveCount(exemption.count);

    const scrollState = await containers.first().evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));

    expect(
      scrollState.overflowX,
      `${label}：豁免容器必须是横向滚动容器（${exemption.reason}）`,
    ).toMatch(/auto|scroll/);
    expect(
      scrollState.scrollWidth,
      `${label}：豁免容器内的表格应宽于容器（${exemption.reason}）`,
    ).toBeGreaterThan(scrollState.clientWidth);
  }

  const { scrollWidth, innerWidth, offenders } =
    await measureHorizontalOverflow(page);

  expect(
    scrollWidth,
    `${label} 在 375px 下横向溢出：scrollWidth=${scrollWidth} > innerWidth=${innerWidth}；越界元素=${JSON.stringify(
      offenders,
    )}`,
  ).toBeLessThanOrEqual(innerWidth);
}

/** 账号 A（主账号：个人项目 / 团队 / 任务 / 邀请的载体）。 */
const ACCOUNT_A = {
  username: uniqueUsername("e2e_rsp_a"),
  password: E2E_PASSWORD,
};

/** 账号 B：作为邀请对手方，让 A 的邀请页与设置页都有真实内容。 */
const ACCOUNT_B = {
  username: uniqueUsername("e2e_rsp_b"),
  password: E2E_PASSWORD,
};

/** 共享账号下的数据快照：beforeAll 通过真实 UI 创建，供各路由断言复用。 */
const data = {
  personalProjectName: uniqueLabel("E2E responsive personal"),
  personalTaskTitle: uniqueLabel("E2E responsive personal task"),
  teamName: uniqueLabel("E2E responsive team"),
  teamProjectName: uniqueLabel("E2E responsive team project"),
  teamTaskTitle: uniqueLabel("E2E responsive team task"),
  personalProjectPath: "",
  personalTaskPath: "",
  teamPath: "",
  teamProjectPath: "",
  teamTaskPath: "",
};

/** 用共享账号 A 登录（每个用例独立 context，状态不会串联）。 */
async function loginSharedAccount(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(ACCOUNT_A.username);
  await page.getByLabel("密码", { exact: true }).fill(ACCOUNT_A.password);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
    timeout: 30_000,
  });
}

/** 从当前地址取路径片段（避免把 origin 带进跳转）。 */
function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/**
 * 通过注册 UI 建两个账号，并用真实页面把响应式用例需要的数据全部建好：
 *
 * - A：个人项目 + 个人任务、团队 + 团队项目 + 团队任务、向 B 发出 1 条邀请；
 * - B：创建团队并向 A 发出 1 条邀请（让 A 的 `/invites` 有待处理卡片）。
 *
 * 不使用数据库直写，保证断言覆盖的是真实渲染路径。
 */
test.describe("375px 无横向溢出", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.describe("未登录", () => {
    test("375px 无横向溢出：/login", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
      await assertNoPageOverflow(page, "/login");
    });

    test("375px 无横向溢出：/register", async ({ page }) => {
      await page.goto("/register");
      await expect(page.getByRole("heading", { name: "创建账号" })).toBeVisible();
      await assertNoPageOverflow(page, "/register");
    });

    test("375px 无横向溢出：/invites（未登录重定向到 /login）", async ({
      page,
    }) => {
      await page.goto("/invites");
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
      await assertNoPageOverflow(page, "/invites（未登录）");
    });

    test("375px 无横向溢出：404 未命中路由", async ({ page }) => {
      const response = await page.goto("/this-route-does-not-exist");
      expect(response?.status()).toBe(404);
      await expect(page.getByText("抱歉，你访问的页面不存在。")).toBeVisible();
      await assertNoPageOverflow(page, "404");
    });
  });

  test.describe("已登录", () => {
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(240_000);

      // 数据准备走桌面视口：团队设置页等桌面信息密度更高；响应式断言本身
      // 仍由外层 `test.use` 固定为 375px。
      const desktopViewport = { width: 1280, height: 720 };

      const contextA = await browser.newContext({
        viewport: desktopViewport,
      });
      const pageA = await contextA.newPage();

      try {
        // A：注册 → 个人项目 + 个人任务。
        await registerUser(pageA, ACCOUNT_A.username, ACCOUNT_A.password);

        await createPersonalProject(pageA, data.personalProjectName);
        await openPersonalProject(pageA, data.personalProjectName);
        data.personalProjectPath = pathOf(pageA);
        expect(data.personalProjectPath).toMatch(
          /\/space\/personal\/projects\/[^/]+$/,
        );

        await createPersonalTask(pageA, { title: data.personalTaskTitle });
        await openPersonalTask(pageA, data.personalTaskTitle);
        data.personalTaskPath = pathOf(pageA);
        expect(data.personalTaskPath).toMatch(
          /\/space\/personal\/tasks\/[0-9a-f-]+$/,
        );

        // A：团队 → 团队项目 → 团队任务。
        await pageA.goto("/teams/new");
        await pageA.getByLabel("团队名称").fill(data.teamName);
        await pageA.getByRole("button", { name: "创建团队" }).click();
        await expect(pageA).toHaveURL(/\/space\/[^/]+\/settings$/, {
          timeout: 30_000,
        });
        const teamSlug = decodeURIComponent(pathOf(pageA).split("/")[2] ?? "");
        expect(teamSlug).not.toBe("");
        data.teamPath = `/space/${encodeURIComponent(teamSlug)}`;

        await pageA.goto(`${data.teamPath}/projects/new`);
        await pageA.getByLabel("项目名称").fill(data.teamProjectName);
        await pageA.getByRole("button", { name: "创建项目" }).click();
        // 只等 URL 会误判：点击前地址已经是 `/projects/new`，同样匹配
        // `/projects/[slug]`。必须等新项目页的标题出现，再记录真实路径。
        await expect(
          pageA.getByRole("heading", {
            name: data.teamProjectName,
            level: 1,
          }),
        ).toBeVisible({ timeout: 30_000 });
        data.teamProjectPath = pathOf(pageA);
        expect(data.teamProjectPath).not.toMatch(/\/projects\/new$/);

        // 空项目页的页头与空状态各有一个「＋ 新建任务」，页头在 DOM 中更靠前。
        await pageA
          .getByRole("button", { name: "＋ 新建任务", exact: true })
          .first()
          .click();
        const teamTaskDialog = pageA.getByRole("dialog");
        await expect(teamTaskDialog).toBeVisible();
        await pageA.waitForTimeout(500);
        await teamTaskDialog.getByLabel("标题").fill(data.teamTaskTitle);
        await teamTaskDialog.getByRole("button", { name: "创建任务" }).click();
        await expect(teamTaskDialog).toBeHidden();

        await pageA
          .getByRole("link", { name: data.teamTaskTitle, exact: true })
          .click();
        await expect(pageA).toHaveURL(
          /\/space\/[^/]+\/projects\/[^/]+\/tasks\/[0-9a-f-]+$/,
        );
        data.teamTaskPath = pathOf(pageA);
      } finally {
        await contextA.close();
      }

      const contextB = await browser.newContext({
        viewport: desktopViewport,
      });
      const pageB = await contextB.newPage();

      try {
        // B：注册后先读自己的 UID（用于 A 的邀请）。
        await registerUser(pageB, ACCOUNT_B.username, ACCOUNT_B.password);
        await pageB.goto("/invites");
        const uidB = (
          await pageB.locator("span.font-mono").first().innerText()
        ).trim();
        expect(uidB).toMatch(/^doing_[a-z0-9]+$/);

        // A 向 B 发出邀请：让 A 的团队设置页渲染「已发出 · 待处理」行。
        const contextA2 = await browser.newContext({
          viewport: desktopViewport,
        });
        const pageA2 = await contextA2.newPage();
        try {
          await loginSharedAccount(pageA2);
          await pageA2.goto(`${data.teamPath}/settings`);
          await pageA2
            .getByLabel("对方 UID")
            .fill(uidB.replace(/^doing_/, ""));
          await pageA2.getByRole("button", { name: "发送邀请" }).click();
          await expect(pageA2.getByText("已发出 · 待处理（1）")).toBeVisible({
            timeout: 30_000,
          });
        } finally {
          await contextA2.close();
        }

        // B 建团队并邀请 A：让 A 的 /invites 有待处理卡片。
        await pageB.goto("/teams/new");
        await pageB.getByLabel("团队名称").fill(uniqueLabel("E2E inviter team"));
        await pageB.getByRole("button", { name: "创建团队" }).click();
        await expect(pageB).toHaveURL(/\/space\/[^/]+\/settings$/, {
          timeout: 30_000,
        });

        // A 的 UID 从 A 自己的邀请页读取（只读 UI，不查库）。
        const contextA3 = await browser.newContext({
          viewport: desktopViewport,
        });
        const pageA3 = await contextA3.newPage();
        let uidA = "";
        try {
          await loginSharedAccount(pageA3);
          await pageA3.goto("/invites");
          uidA = (
            await pageA3.locator("span.font-mono").first().innerText()
          ).trim();
        } finally {
          await contextA3.close();
        }
        expect(uidA).toMatch(/^doing_[a-z0-9]+$/);

        await pageB.getByLabel("对方 UID").fill(uidA.replace(/^doing_/, ""));
        await pageB.getByRole("button", { name: "发送邀请" }).click();
        await expect(pageB.getByText("已发出 · 待处理（1）")).toBeVisible({
          timeout: 30_000,
        });
      } finally {
        await contextB.close();
      }
    });

    /**
     * 已登录路由清单。
     *
     * `path` 用函数形式在用例执行时读取 beforeAll 写入的 slug / id，
     * 测试名保持稳定的路由模板，失败时能直接对应到路由。
     */
    const routes: {
      name: string;
      path: () => string;
      exemptions?: InCardScrollExemption[];
    }[] = [
      {
        name: "/space/personal/dashboard",
        path: () => "/space/personal/dashboard",
      },
      {
        name: "/space/personal/projects/[projectSlug]（列表）",
        path: () => data.personalProjectPath,
        exemptions: [PERSONAL_PROJECT_TABLE],
      },
      {
        name: "/space/personal/projects/[projectSlug]?view=board（看板）",
        path: () => `${data.personalProjectPath}?view=board`,
      },
      {
        name: "/space/personal/tasks/[taskId]",
        path: () => data.personalTaskPath,
      },
      {
        name: "/invites",
        path: () => "/invites",
      },
      {
        name: "/teams/new",
        path: () => "/teams/new",
      },
      {
        name: "/space/[teamSlug]/dashboard（团队 Dashboard）",
        path: () => `${data.teamPath}/dashboard`,
      },
      {
        name: "/space/[teamSlug]/settings",
        path: () => `${data.teamPath}/settings`,
        exemptions: [TEAM_SETTINGS_MEMBERS],
      },
      {
        name: "/space/[teamSlug]/projects/new",
        path: () => `${data.teamPath}/projects/new`,
      },
      {
        name: "/space/[teamSlug]/projects/[projectSlug]（列表）",
        path: () => data.teamProjectPath,
        exemptions: [TEAM_PROJECT_TABLE],
      },
      {
        name: "/space/[teamSlug]/projects/[projectSlug]?view=board（看板）",
        path: () => `${data.teamProjectPath}?view=board`,
      },
      {
        name: "/space/[teamSlug]/projects/[projectSlug]/tasks/[taskId]",
        path: () => data.teamTaskPath,
      },
    ];

    // 每个已登录路由的关键内容：等内容出现再测量，避免测到 RSC 流式渲染
    // 的中间态（骨架还没有内容，宽度自然不溢出，等于白测）。
    const readyByRoute: Record<string, (page: Page) => Promise<void>> = {
      "/space/personal/dashboard": async (page) => {
        await expect(
          page.getByRole("heading", { name: "Dashboard", level: 1 }),
        ).toBeVisible();
        // 统计卡与「今天」列表都是 v1.1 新 Dashboard 的骨架。
        await expect(page.getByText("本周已完成", { exact: true })).toBeVisible();
        await expect(
          page.getByRole("heading", { name: /^今天 · / }),
        ).toBeVisible();
      },
      "/space/personal/projects/[projectSlug]（列表）": async (page) => {
        await expect(
          page.getByRole("heading", {
            name: data.personalProjectName,
            level: 1,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: data.personalTaskTitle, exact: true }),
        ).toBeVisible();
      },
      "/space/personal/projects/[projectSlug]?view=board（看板）": async (
        page,
      ) => {
        await expect(
          page.locator('section[aria-label="未开始"]'),
        ).toBeVisible();
        await expect(
          page.getByText(data.personalTaskTitle, { exact: true }),
        ).toBeVisible();
      },
      "/space/personal/tasks/[taskId]": async (page) => {
        await expect(
          page.getByRole("heading", {
            name: data.personalTaskTitle,
            level: 1,
          }),
        ).toBeVisible();
      },
      "/invites": async (page) => {
        await expect(
          page.getByRole("heading", { name: "待处理邀请", level: 1 }),
        ).toBeVisible();
        // A 收到 B 的邀请：待处理卡片（含接受 / 拒绝按钮）必须真实渲染。
        await expect(page.getByText("待处理（1）")).toBeVisible();
        await expect(
          page.getByRole("button", { name: /^接\s*受$/ }),
        ).toBeVisible();
      },
      "/teams/new": async (page) => {
        await expect(
          page.getByRole("heading", { name: "创建团队", level: 1 }),
        ).toBeVisible();
      },
      "/space/[teamSlug]/dashboard（团队 Dashboard）": async (page) => {
        await expect(
          page.getByRole("heading", { name: "Dashboard", level: 1 }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "项目健康度", level: 2 }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "重要节点", level: 2 }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "成员负载", level: 2 }),
        ).toBeVisible();
      },
      "/space/[teamSlug]/settings": async (page) => {
        await expect(
          page.getByRole("heading", { name: "团队设置", level: 1 }),
        ).toBeVisible();
        // 成员表 + 已发出邀请行：375px 下最容易溢出的两处长内容。
        await expect(page.getByText(`成员（1）`)).toBeVisible();
        await expect(page.getByText("已发出 · 待处理（1）")).toBeVisible();
      },
      "/space/[teamSlug]/projects/new": async (page) => {
        await expect(
          page.getByRole("heading", { name: "新建项目", level: 1 }),
        ).toBeVisible();
      },
      "/space/[teamSlug]/projects/[projectSlug]（列表）": async (page) => {
        await expect(
          page.getByRole("heading", {
            name: data.teamProjectName,
            level: 1,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: data.teamTaskTitle, exact: true }),
        ).toBeVisible();
      },
      "/space/[teamSlug]/projects/[projectSlug]?view=board（看板）": async (
        page,
      ) => {
        await expect(
          page.locator('section[aria-label="未开始"]'),
        ).toBeVisible();
        await expect(
          page.getByText(data.teamTaskTitle, { exact: true }),
        ).toBeVisible();
      },
      "/space/[teamSlug]/projects/[projectSlug]/tasks/[taskId]": async (
        page,
      ) => {
        await expect(
          page.getByRole("heading", { name: data.teamTaskTitle, level: 1 }),
        ).toBeVisible();
      },
    };

    for (const route of routes) {
      test(`375px 无横向溢出：${route.name}`, async ({ page }) => {
        await loginSharedAccount(page);
        await page.goto(route.path());
        await readyByRoute[route.name](page);
        await assertNoPageOverflow(page, route.name, route.exemptions ?? []);
      });
    }
  });
});
