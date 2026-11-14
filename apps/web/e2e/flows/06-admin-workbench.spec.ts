import { expect, test } from "@playwright/test";
import postgres, { type Sql } from "postgres";

import zhMessages from "../../src/i18n/messages/zh.json";
import {
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  assertE2EDatabaseUrl,
} from "../utils/env";
import { TEST_IDS } from "../utils/testids";
import {
  E2E_PASSWORD,
  E2E_REGISTRATION_CODE,
  loginUser,
  registerUser,
  uniqueUsername,
} from "../utils/flows";

/**
 * 关键流 6（管理台）：管理员全链路（Review Focus 1 / 4 的端到端证据）。
 *
 * 1. admin-user 经真实注册页建号，随后在 e2e 库用 SQL 翻 is_admin（管理台
 *    没有自举入口，首个管理员按计划用 SQL 赋权），再清 cookie 重新登录；
 * 2. `/admin` 概览可达且统计卡渲染；顺带覆盖非 UUID 详情地址 → 404；
 * 3. 注册码页新增 maxUses=3 的码 → 新行出现；展开种子码使用者可见 admin
 *    自己（Review Focus 4：usedBy 由 users.registration_code_id 关联）；
 * 4. victim 在独立浏览器上下文注册并停留在 dashboard（保持在线会话）；
 * 5. 用户列表按用户名搜索（`?q=`）收敛到 victim；打开详情页禁用（二次确认
 *    + toast），再在「已禁用」筛选下看到 victim；
 * 6. 在线会话强制下线（Review Focus 1）：victim 下一次请求被踢回 /login，
 *    随后的登录表单返回 accountDisabled 错误；
 * 7. 管理员解禁 → victim 重新登录成功。
 *
 * 断言一律走 data-testid / role；zh 文案取自消息包（`zh.json`），不硬编码。
 */

// 两个账号、两个浏览器上下文 + 多次 RSC 往返，放宽到 120s。
test.describe.configure({ timeout: 120_000 });

/** 文案 key（仅 admin / auth / nav 命名空间；值取自 zh 消息包固定文本）。 */
function adminCopy(
  key: keyof typeof zhMessages.admin,
  params?: Record<string, string>,
): string {
  const template: string = zhMessages.admin[key];
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

/** 业务侧栏管理入口文案（nav.adminConsole，值取自 zh 消息包）。 */
function navConsoleLabel(): string {
  return zhMessages.nav.adminConsole;
}

/**
 * 在 e2e 库上执行一组查询：调用前校验库名，结束一定释放连接。
 *
 * 与 global-setup / 既有 flow 的客户端构造保持一致（单连接、静默 NOTICE）。
 */
async function withE2EDb<T>(run: (client: Sql) => Promise<T>): Promise<T> {
  assertE2EDatabaseUrl(E2E_DATABASE_URL);

  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    return await run(client);
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** 直接把账号标记为管理员（管理台没有自举入口，按计划用 SQL 赋权）。 */
async function promoteAdmin(username: string): Promise<void> {
  await withE2EDb(async (client) => {
    const rows = await client`
      UPDATE users SET is_admin = true WHERE username = ${username} RETURNING id
    `;
    expect(rows.length).toBe(1);
  });
}

/** 读取用户的内部 UUID（详情页 URL / 管理操作入参均以 UUID 标识）。 */
async function userIdOf(username: string): Promise<string> {
  return withE2EDb(async (client) => {
    const rows = await client`
      SELECT id FROM users WHERE username = ${username} LIMIT 1
    `;
    expect(rows.length).toBe(1);
    return rows[0]!.id as string;
  });
}

/** 本流程新建的注册码（maxUses=3 唯一，用于定位新行）。 */
async function newestCodeWithMaxUses3(): Promise<string> {
  return withE2EDb(async (client) => {
    const rows = await client`
      SELECT code FROM registration_codes
      WHERE max_uses = 3
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(rows.length).toBe(1);
    return rows[0]!.code as string;
  });
}

/** 读取用户的禁用标记（UI 之外的第二证据）。 */
async function isDisabled(username: string): Promise<boolean> {
  return withE2EDb(async (client) => {
    const rows = await client`
      SELECT is_disabled FROM users WHERE username = ${username} LIMIT 1
    `;
    expect(rows.length).toBe(1);
    return rows[0]!.is_disabled as boolean;
  });
}

test.describe("flow 6: admin workbench", () => {
  test("admin creates a code, disables an online user and re-enables them", async ({
    page,
    browser,
  }) => {
    const adminUsername = uniqueUsername("e2e_admin");
    const victimUsername = uniqueUsername("e2e_victim");

    // ===== 1. admin 经 UI 注册 → SQL 赋权 → 重新登录 =====
    await registerUser(page, adminUsername);
    await promoteAdmin(adminUsername);

    // 清掉旧会话 cookie 再走登录页（等价于重新登录），避免复用未带
    // is_admin 语义的旧页面状态。
    await page.context().clearCookies();
    await loginUser(page, adminUsername);

    // 业务侧栏「管理控制台」入口：仅 is_admin 用户可见（登录落在个人
    // dashboard，桌面侧栏直接断言）。
    const adminNavLink = page.getByRole("link", { name: navConsoleLabel() });
    await expect(adminNavLink).toBeVisible();

    // ===== 2. /admin 概览可达，统计卡已渲染 =====
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: adminCopy("overviewTitle"),
      }),
    ).toBeVisible();
    await expect(
      page.getByText(adminCopy("statUsers"), { exact: true }),
    ).toBeVisible();

    // 扩展：非 UUID 的详情地址直接 404（不进数据库查询、不泄露存在性）。
    const missingResponse = await page.goto("/admin/users/not-a-uuid");
    expect(missingResponse?.status()).toBe(404);
    await expect(
      page.getByTestId(TEST_IDS.misc.notFoundMessage),
    ).toBeVisible();

    // ===== 3. 注册码页：新增 maxUses=3 的码，并展开种子码使用者 =====
    await page.goto("/admin/registration-codes");
    await page.getByTestId(TEST_IDS.admin.createCodeTrigger).click();

    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    await createDialog
      .getByTestId(TEST_IDS.admin.codeMaxUsesInput)
      .fill("3");
    await createDialog.getByTestId(TEST_IDS.admin.createCodeSubmit).click();
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();

    // 新码行（码值由服务端生成，从 e2e 库按唯一 maxUses 读回）。
    const newCode = await newestCodeWithMaxUses3();
    await expect(
      page.getByTestId(TEST_IDS.admin.codeUsersToggle(newCode)),
    ).toBeVisible();

    // Review Focus 4：admin 自己凭种子码注册，展开使用者列表可见其昵称。
    // 作用域限定在表格内，避开管理侧栏用户条的同名文本。
    const codesTable = page.getByRole("table");
    await page
      .getByTestId(TEST_IDS.admin.codeUsersToggle(E2E_REGISTRATION_CODE))
      .click();
    await expect(codesTable.getByText(adminUsername, { exact: true })).toBeVisible();

    // ===== 4. victim 在独立上下文注册并停留在 dashboard =====
    const victimContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    const victimPage = await victimContext.newPage();

    try {
      await registerUser(victimPage, victimUsername);
      await expect(
        victimPage.getByRole("heading", { level: 1 }),
      ).toBeVisible();

      // 普通用户侧栏不出现管理入口（服务端按 is_admin 判定，无 DOM）。
      await expect(
        victimPage.getByRole("link", { name: navConsoleLabel() }),
      ).toHaveCount(0);

      const victimId = await userIdOf(victimUsername);

      // ===== 5a. 用户列表搜索（?q=）收敛到 victim =====
      await page.goto("/admin/users");
      await page.getByTestId(TEST_IDS.admin.usersSearch).fill(victimUsername);
      await expect(page).toHaveURL(
        new RegExp(`/admin/users\\?q=${victimUsername}$`),
      );

      const victimRow = page.getByRole("row", {
        name: new RegExp(victimUsername),
      });
      await expect(victimRow).toBeVisible();
      await expect(
        page.getByRole("row", { name: new RegExp(adminUsername) }),
      ).toHaveCount(0);

      // 状态筛选先做一次对照：未禁用时「已禁用」里没有 victim。
      await page.getByTestId(TEST_IDS.admin.usersStatus("disabled")).click();
      await expect(page).toHaveURL(/status=disabled/);
      await expect(victimRow).toHaveCount(0);

      // ===== 5b. 详情页禁用（ConfirmModal + toast）=====
      await page.goto(`/admin/users/${victimId}`);
      await expect(page.getByTestId(TEST_IDS.admin.userDisable)).toBeVisible();

      await page.getByTestId(TEST_IDS.admin.userDisable).click();
      const confirmDialog = page.getByRole("dialog");
      await expect(confirmDialog).toBeVisible();
      await confirmDialog
        .getByTestId(TEST_IDS.admin.userActionConfirm)
        .click();

      await expect(
        page.getByText(
          adminCopy("disableSuccess", { name: victimUsername }),
          { exact: true },
        ),
      ).toBeVisible();
      // 刷新后按钮切换为「解禁该用户」= 禁用已落库。
      await expect(page.getByTestId(TEST_IDS.admin.userEnable)).toBeVisible();
      expect(await isDisabled(victimUsername)).toBe(true);

      // 扩展：禁用生效后，「已禁用」筛选下出现 victim（正常筛选下消失）。
      await page.goto(`/admin/users?q=${victimUsername}`);
      await page.getByTestId(TEST_IDS.admin.usersStatus("disabled")).click();
      await expect(page).toHaveURL(/status=disabled/);
      await expect(victimRow).toBeVisible();
      await expect(
        victimRow.getByText(adminCopy("statusDisabled"), { exact: true }),
      ).toBeVisible();

      await page.getByTestId(TEST_IDS.admin.usersStatus("active")).click();
      await expect(victimRow).toHaveCount(0);

      // ===== 6. 在线会话强制下线 + 登录被拒（Review Focus 1）=====
      // victim 页面一直停在 dashboard；禁用后下一次请求会清空其会话并回 /login。
      await victimPage.reload();
      await expect(victimPage).toHaveURL(/\/login$/, { timeout: 30_000 });

      await victimPage
        .getByTestId(TEST_IDS.auth.usernameInput)
        .fill(victimUsername);
      await victimPage
        .getByTestId(TEST_IDS.auth.passwordInput)
        .fill(E2E_PASSWORD);
      await victimPage.getByTestId(TEST_IDS.auth.submitButton).click();

      // 登录表单错误不是 better-auth 英文原文，而是 auth.accountDisabled。
      // 按文案过滤：Next 的路由播报器也带 role="alert"（aria-live 容器）。
      await expect(
        victimPage
          .getByRole("alert")
          .filter({ hasText: zhMessages.auth.accountDisabled }),
      ).toHaveText(zhMessages.auth.accountDisabled);
      await expect(victimPage).toHaveURL(/\/login$/);

      // ===== 7. 管理员解禁 → victim 重新登录成功 =====
      await page.goto(`/admin/users/${victimId}`);
      await expect(page.getByTestId(TEST_IDS.admin.userEnable)).toBeVisible();

      await page.getByTestId(TEST_IDS.admin.userEnable).click();
      const enableDialog = page.getByRole("dialog");
      await expect(enableDialog).toBeVisible();
      await enableDialog.getByTestId(TEST_IDS.admin.userActionConfirm).click();

      await expect(
        page.getByText(
          adminCopy("enableSuccess", { name: victimUsername }),
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByTestId(TEST_IDS.admin.userDisable)).toBeVisible();
      expect(await isDisabled(victimUsername)).toBe(false);

      await loginUser(victimPage, victimUsername);
    } finally {
      await victimContext.close();
    }
  });
});
