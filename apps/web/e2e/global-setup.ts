import path from "node:path";
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from "./utils/env";
import { E2E_REGISTRATION_CODE } from "./utils/flows";

/** 需要清空的业务表（单条 TRUNCATE ... CASCADE 一次清空）；必须与 schema.ts 的业务表保持一致，并与 src/server/db/testing.ts 的列表逐表同步。 */
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
 * 3. TRUNCATE 全部业务表（RESTART IDENTITY CASCADE），保证每次 e2e 运行都从干净状态开始。
 *
 * 只触碰 e2e 库；开发库与 Vitest 测试库不参与本流程。
 */
export default async function globalSetup(): Promise<void> {
  assertE2EDatabaseUrl(E2E_DATABASE_URL);

  // 单连接：迁移与清库共用同一个会话，避免迁移锁与 TRUNCATE 跨连接。
  const pool = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(pool);

    // 相对本文件定位，避免依赖 playwright 进程的 cwd。
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    await migrate(db, { migrationsFolder });

    // 表名为静态常量，不存在注入面；单条语句即可原子清空全部业务表。
    await db.execute(sql`
      TRUNCATE TABLE
        ${sql.raw(TRUNCATE_TABLES.join(", "))}
      RESTART IDENTITY CASCADE
    `);

    // 预置 e2e 注册码：注册现要求凭码，全部流程共用这一个固定码。
    // 上限放宽到 100：全量套件约需 35 次注册（每用例独立注册），
    // 业务默认的 10 次会在中段耗尽，导致其后所有注册超时。
    // 码列唯一索引兜底；这里用原生 SQL，避免 import 应用 db 模块
    // （client.ts 会按 DATABASE_URL 建池，e2e 进程里不存在该变量）。
    await db.execute(
      sql`INSERT INTO registration_codes (id, code, max_uses, used_count) VALUES (${randomUUID()}, ${E2E_REGISTRATION_CODE}, 100, 0)`,
    );
  } finally {
    await pool.end({ timeout: 5 });
  }
}
