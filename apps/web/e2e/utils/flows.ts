import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { TEST_IDS } from "./testids";

/** 五条流共用的测试密码（满足 8 位下限）。 */
export const E2E_PASSWORD = "e2e-password-123";

/**
 * e2e 注册码（封测注册必须凭码）：由 global-setup 在每次运行开始时
 * 预置进 e2e 库，全部流程共用；不在仓库其它地方重复定义。
 */
export const E2E_REGISTRATION_CODE = "E2EREGCO";

/** 生成全局唯一的用户名（2–20 字符，符合注册校验）。 */
export function uniqueUsername(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** 生成不会与其它用例冲突的展示名称（项目 / 团队 / 任务）。 */
export function uniqueLabel(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 6)}`;
}

/**
 * 通过注册页创建账号，并等待进入个人空间 Dashboard。
 *
 * 所有用例都走真实 UI + Server Action + 数据库，不预置种子数据。
 * 昵称显式填成用户名：全站展示名取 nickname，未填时注册会生成 `user_xxxxx`，
 * 会让流程中按用户名断言的展示文案失效。
 */
export async function registerUser(
  page: Page,
  username: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/register");
  await page.getByTestId(TEST_IDS.auth.usernameInput).fill(username);
  await page.getByTestId(TEST_IDS.auth.nicknameInput).fill(username);
  await page.getByTestId(TEST_IDS.auth.passwordInput).fill(password);
  await page.getByTestId(TEST_IDS.auth.passwordConfirmInput).fill(password);
  await page.getByTestId(TEST_IDS.auth.registrationCodeInput).fill(E2E_REGISTRATION_CODE);
  await page.getByTestId(TEST_IDS.auth.submitButton).click();

  await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "仪表盘", level: 1 }),
  ).toBeVisible();
}

/** 通过登录页登录已有账号。 */
export async function loginUser(
  page: Page,
  username: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId(TEST_IDS.auth.usernameInput).fill(username);
  await page.getByTestId(TEST_IDS.auth.passwordInput).fill(password);
  await page.getByTestId(TEST_IDS.auth.submitButton).click();

  await expect(page).toHaveURL(/\/space\/personal\/dashboard$/, {
    timeout: 30_000,
  });
}

/**
 * 由项目名称推导个人项目 slug（与服务端 `generateUniqueSlug` 同口径）。
 *
 * 个人 Dashboard 不再在侧栏列出项目，创建后没有可点击的项目入口；
 * e2e 的标签均为 ASCII 且带随机后缀（建库后不会触发 `-2` 冲突后缀），
 * 因此可以直接按同一规则算出项目页地址。
 */
export function personalProjectSlug(projectName: string): string {
  return (
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/**
 * 在个人空间创建项目（Dashboard 页头「新建个人项目」→ 弹窗）。
 *
 * 必须从 `/space/personal/dashboard` 调用——新 IA 只在页头提供该入口。
 */
export async function createPersonalProject(
  page: Page,
  projectName: string,
): Promise<void> {
  await page.getByTestId(TEST_IDS.projects.newPersonalProjectButton).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 弹窗的 afterOpenChange 会在开启动画结束后 resetFields；等它完成再填写，
  // 否则刚填入的值会被重置（Ant Design 关闭后卸载表单的行为）。
  await page.waitForTimeout(500);
  await dialog
    .getByTestId(TEST_IDS.projects.projectNameInput)
    .fill(projectName);
  await dialog.getByTestId(TEST_IDS.projects.projectSubmitButton).click();

  // 新 IA 不再把项目挂到侧栏，只能以成功 toast 确认创建完成（文案本身是被测行为）。
  await expect(page.getByText("项目已创建")).toBeVisible();
  await expect(dialog).toBeHidden();
}

/** 打开个人项目页（按名称推导 slug，验证页面真实渲染）。 */
export async function openPersonalProject(
  page: Page,
  projectName: string,
): Promise<void> {
  await page.goto(
    `/space/personal/projects/${personalProjectSlug(projectName)}`,
  );
  await expect(
    page.getByRole("heading", { name: projectName, level: 1 }),
  ).toBeVisible();
}

/**
 * 在项目页创建个人任务。
 *
 * `dueDate` 使用 `YYYY-MM-DD`（与应用及数据库 date 列口径一致）。
 */
export async function createPersonalTask(
  page: Page,
  input: { title: string; dueDate?: string },
): Promise<void> {
  await page.getByTestId(TEST_IDS.tasks.newTaskButton).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 同上：等 afterOpenChange 的 resetFields 执行完再填写。
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

/** 从项目列表打开任务详情。 */
export async function openPersonalTask(
  page: Page,
  title: string,
): Promise<void> {
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/space\/personal\/tasks\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
}

/** 上海时区的今天，格式 `YYYY-MM-DD`（与 due-scan / 页面日期口径一致）。 */
export function shanghaiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
