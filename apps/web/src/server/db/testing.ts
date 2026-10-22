import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { DbClient } from "./client";

/** 迁移目录：apps/web/drizzle（相对本文件定位，不依赖执行 cwd）。 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

let sqlClient: ReturnType<typeof postgres> | null = null;
let testDb: DbClient | null = null;

function getTestDb(): DbClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL 未设置，无法初始化测试数据库");
  }

  if (!testDb) {
    sqlClient = postgres(url, { max: 1 });
    testDb = drizzle(sqlClient, { schema });
  }

  return testDb;
}

/**
 * 初始化测试数据库：
 * 1. 用 drizzle migrator 对 TEST_DATABASE_URL 重放 ./drizzle 迁移（同时验证迁移可重放）；
 * 2. TRUNCATE 全部业务表（RESTART IDENTITY CASCADE），保证用例间隔离。
 *
 * 返回可复用的 db 实例；测试结束时调用 closeTestDb() 释放连接。
 */
export async function setupTestDb(): Promise<DbClient> {
  const db = getTestDb();

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
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

  return db;
}

/** 关闭测试数据库连接（vitest afterAll 调用，避免进程挂起）。 */
export async function closeTestDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
  }
  sqlClient = null;
  testDb = null;
}
