import { defineConfig, devices } from "@playwright/test";

import {
  E2E_BASE_URL,
  E2E_CRON_SECRET,
  E2E_DATABASE_URL,
  E2E_PORT,
  E2E_SESSION_SECRET,
} from "./e2e/utils/env";

/**
 * Playwright e2e 配置（Track X X-1）。
 *
 * - 独立端口 3100，避免与 docker compose 的 web（3000）冲突；
 * - webServer 显式注入 e2e 库与测试密钥，不读取 `apps/web/.env.local`；
 * - globalSetup 先校验库名、重放迁移并 TRUNCATE，见 e2e/global-setup.ts；
 * - 串行执行：五条流共用同一个 e2e 库，串行可避免互相干扰（尤其是 cron 扫描）。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: E2E_SESSION_SECRET,
      CRON_SECRET: E2E_CRON_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
