import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from "./utils/env";

/**
 * Playwright 全局准备：
 * 1. 先断言 DATABASE_URL 的库名恰好是 `open_doing_e2e`（否则抛错阻止清库）；
 * 2. 重放 `apps/web/drizzle` 迁移（空库可建、已有库可重复执行）；
 * 3. 关闭外键检查后 TRUNCATE 全部业务表，保证每次 e2e 运行都从干净状态开始。
 *
 * 只触碰 e2e 库；开发库与 Vitest 测试库不参与本流程。
 */
export default async function globalSetup(): Promise<void> {
  assertE2EDatabaseUrl(E2E_DATABASE_URL);

  // 单连接：FOREIGN_KEY_CHECKS 是会话级变量，单连接保证 SET/TRUNCATE 同会话。
  const pool = mysql.createPool({ uri: E2E_DATABASE_URL, connectionLimit: 1 });
  try {
    const db = drizzle(pool);

    // 相对本文件定位，避免依赖 playwright 进程的 cwd。
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    await migrate(db, { migrationsFolder });

    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    try {
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
      `);
    } finally {
      await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    }
  } finally {
    await pool.end();
  }
}
