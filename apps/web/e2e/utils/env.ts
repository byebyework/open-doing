/**
 * Playwright e2e 环境的显式配置。
 *
 * 该模块同时被 playwright.config.ts（启动 dev server 前注入环境变量）、
 * global-setup.ts（迁移与清库）和 spec（cron 鉴权）引用。
 *
 * 约束（对应 Track X Task 2 / Review Focus 1）：
 * - DATABASE_URL 只能指向独立的 Playwright 库 `open_doing_e2e`；
 * - 绝不能指向开发库 `open_doing` 或 Vitest 测试库 `open_doing_test`；
 * - SESSION_SECRET / CRON_SECRET 仅为测试值，不用于任何真实环境。
 */
export const E2E_DATABASE_URL =
  "postgres://open-doing:open-doing@localhost:5432/open_doing_e2e";

export const E2E_SESSION_SECRET = "e2e-session-secret-not-for-production";
export const E2E_CRON_SECRET = "e2e-cron-secret-not-for-production";

/** e2e dev server 端口：与 docker compose 的 web (3000) 及常规 `pnpm dev` 错开。 */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * 断言连接串指向 `open_doing_e2e`。
 *
 * 在任何迁移 / TRUNCATE 之前调用；不匹配时直接抛错终止整套用例，
 * 避免误清开发库或 Vitest 测试库。
 */
export function assertE2EDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[e2e] 非法的 DATABASE_URL：${url}`);
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (database !== "open_doing_e2e") {
    throw new Error(
      `[e2e] 拒绝执行：DATABASE_URL 必须指向 open_doing_e2e，实际为「${database}」`,
    );
  }
}
