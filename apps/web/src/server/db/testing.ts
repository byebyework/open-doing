import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { fileURLToPath } from "node:url";
import mysql, { type Pool } from "mysql2/promise";
import * as schema from "./schema";
import type { DbClient } from "./client";

/** 迁移目录：apps/web/drizzle（相对本文件定位，不依赖执行 cwd）。 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

let pool: Pool | null = null;
let testDb: DbClient | null = null;

function getTestDb(): DbClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL 未设置，无法初始化测试数据库");
  }

  if (!testDb) {
    // 连接数固定为 1：TRUNCATE 前设置的 FOREIGN_KEY_CHECKS 是会话级变量，
    // 单连接池保证 SET、TRUNCATE、恢复 SET 落在同一个会话里。
    pool = mysql.createPool({ uri: url, connectionLimit: 1 });
    testDb = drizzle(pool, { schema, mode: "default" });
  }

  return testDb;
}

/**
 * 初始化测试数据库：
 * 1. 用 drizzle migrator 对 TEST_DATABASE_URL 重放 ./drizzle 迁移（同时验证迁移可重放）；
 * 2. 关闭外键检查后 TRUNCATE 全部业务表（MySQL 无 RESTART IDENTITY CASCADE，
 *    自增计数随 TRUNCATE 重置），保证用例间隔离。
 *
 * 返回可复用的 db 实例；测试结束时调用 closeTestDb() 释放连接。
 */
export async function setupTestDb(): Promise<DbClient> {
  const db = getTestDb();

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

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
    // 失败时也务必恢复外键检查，避免后续用例在关闭约束的会话里跑。
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  }

  return db;
}

/** 关闭测试数据库连接（vitest afterAll 调用，避免进程挂起）。 */
export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
  }
  pool = null;
  testDb = null;
}
