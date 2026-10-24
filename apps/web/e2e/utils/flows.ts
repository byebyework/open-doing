import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

/** 五条流共用的测试密码（满足 8 位下限）。 */
export const E2E_PASSWORD = "e2e-password-123";

/** 生成全局唯一的用户名（2–20 字符，符合注册校验）。 */
export function uniqueUsername(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** 生成不会与其它用例冲突的展示名称（项目 / 团队 / 任务）。 */
export function uniqueLabel(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 6)}`;
}

/**
 * 通过注册页创建账号，并等待进入「我的任务」。
 *
 * 所有用例都走真实 UI + Server Action + 数据库，不预置种子数据。
 */
export async function registerUser(
  page: Page,
  username: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByRole("button", { name: /注\s*册/ }).click();

  await expect(page).toHaveURL(/\/my$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "我的任务", level: 1 }),
  ).toBeVisible();
}

/** 通过登录页登录已有账号。 */
export async function loginUser(
  page: Page,
  username: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: /登\s*录/ }).click();

  await expect(page).toHaveURL(/\/my$/, { timeout: 30_000 });
}

/**
 * 在个人空间创建项目（侧栏「＋」入口 → 弹窗）。
 *
 * 成功后侧栏出现同名项目链接。
 */
export async function createPersonalProject(
  page: Page,
  projectName: string,
): Promise<void> {
  await page.getByRole("button", { name: "新建项目" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 弹窗的 afterOpenChange 会在开启动画结束后 resetFields；等它完成再填写，
  // 否则刚填入的值会被重置（Ant Design 关闭后卸载表单的行为）。
  await page.waitForTimeout(500);
  await dialog.getByLabel("项目名称").fill(projectName);
  await dialog.getByRole("button", { name: "创建项目" }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("link", { name: projectName, exact: true }),
  ).toBeVisible();
}

/** 打开侧栏中的个人项目页。 */
export async function openPersonalProject(
  page: Page,
  projectName: string,
): Promise<void> {
  await page
    .getByRole("link", { name: projectName, exact: true })
    .first()
    .click();
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
  // 空项目会在页头和空状态各渲染一个「＋ 新建任务」，两者打开同一个弹窗；
  // 页头按钮在 DOM 中更靠前。
  await page
    .getByRole("button", { name: "＋ 新建任务", exact: true })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 同上：等 afterOpenChange 的 resetFields 执行完再填写。
  await page.waitForTimeout(500);
  await dialog.getByLabel("标题").fill(input.title);
  if (input.dueDate) {
    await dialog.getByLabel("截止日期").fill(input.dueDate);
  }
  await dialog.getByRole("button", { name: "创建任务" }).click();

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
  await expect(page).toHaveURL(/\/my\/tasks\/[0-9a-f-]+$/);
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
