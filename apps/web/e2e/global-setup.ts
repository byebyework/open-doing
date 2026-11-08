import path from "node:path";
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from "./utils/env";
import { E2E_REGISTRATION_CODE } from "./utils/flows";

/** 需要清空的业务表（顺序与迁移无关，外键检查已关闭）；必须与 schema.ts 的业务表保持一致，并与 src/server/db/testing.ts 的列表逐表同步。 */
const TRUNCATE_TABLES = [
  "notifications",
  "comments",
  "subtasks",
  "tasks",
  "team_invites",
  "team_join_requests",
  "team_memberships",
  "projects",
  "registration_codes",
  "teams",
  "users",
] as const;

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
  // 时区与 client.ts 保持一致：`timezone` 只影响 JS Date 编解码，会话时区
  // 仍需显式 `SET time_zone`（容器默认 SYSTEM=UTC，否则差 8 小时）。
  const pool = mysql.createPool({
    uri: E2E_DATABASE_URL,
    connectionLimit: 1,
    timezone: "+08:00",
  });
  pool.on("connection", (conn) => {
    void conn.query("SET time_zone = '+08:00'");
  });
  try {
    const db = drizzle(pool);

    // 相对本文件定位，避免依赖 playwright 进程的 cwd。
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    await migrate(db, { migrationsFolder });

    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    try {
      // MySQL 的 TRUNCATE 一次只能截断一张表（PG 的多表写法在这里是语法错误）；
      // 表名为静态常量，不存在注入面。
      for (const table of TRUNCATE_TABLES) {
        await db.execute(sql.raw(`TRUNCATE TABLE \`${table}\``));
      }
    } finally {
      await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    }

    // 预置 e2e 注册码：注册现要求凭码，全部流程共用这一个固定码。
    // 上限放宽到 100：全量套件约需 35 次注册（每用例独立注册），
    // 业务默认的 10 次会在中段耗尽，导致其后所有注册超时。
    // 码列唯一索引兜底；这里用原生 SQL，避免 import 应用 db 模块
    // （client.ts 会按 DATABASE_URL 建池，e2e 进程里不存在该变量）。
    await db.execute(
      sql`INSERT INTO registration_codes (id, code, max_uses, used_count) VALUES (${randomUUID()}, ${E2E_REGISTRATION_CODE}, 100, 0)`,
    );
  } finally {
    await pool.end();
  }
}
