import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from "./utils/env";

/**
 * Playwright 全局准备：
 * 1. 先断言 DATABASE_URL 的库名恰好是 `open_doing_e2e`（否则抛错阻止清库）；
 * 2. 重放 `apps/web/drizzle` 迁移（空库可建、已有库可重复执行）；
 * 3. TRUNCATE 全部业务表，保证每次 e2e 运行都从干净状态开始。
 *
 * 只触碰 e2e 库；开发库与 Vitest 测试库不参与本流程。
 */
export default async function globalSetup(): Promise<void> {
  assertE2EDatabaseUrl(E2E_DATABASE_URL);

  const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client);

    // 相对本文件定位，避免依赖 playwright 进程的 cwd。
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    await migrate(db, { migrationsFolder });

    await db.execute(sql`
      TRUNCATE TABLE
        notifications,
        comments,
        subtasks,
        tasks,
        team_invites,
        team_memberships,
        projects,
        teams,
        users
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end({ timeout: 5 });
  }
}
