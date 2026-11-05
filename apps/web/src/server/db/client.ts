import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

/**
 * 数据库连接单例。
 *
 * - 运行时只使用 `DATABASE_URL`（开发库），**绝不回退到 `TEST_DATABASE_URL`**：
 *   否则开发服务器会连上测试库，而 `pnpm test` 会 TRUNCATE 该库，导致开发数据丢失。
 * - `TEST_DATABASE_URL` 仅由 `testing.ts` 在数据库测试中使用（迁移 + 清库）。
 * - 缓存到 globalThis，避免 Next.js 开发热重载时反复创建连接池。
 * - 仅当变量缺失时使用本地默认值，防止构建/工具链在导入阶段直接崩溃；
 *   生产环境缺失配置会显式报错。
 * - `timezone: "+08:00"` 只影响 mysql2 对 JS Date 的编解码；MySQL 的
 *   `NOW()` / `CURRENT_TIMESTAMP` 取的是会话时区，因此每条池内连接建立后
 *   都显式执行一次 `SET time_zone`，与 Asia/Shanghai 的业务时间语义一致。
 */
type Database = MySql2Database<typeof schema>;

function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;

  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 DATABASE_URL 环境变量");
  }

  return "mysql://open-doing:open-doing@localhost:3307/open_doing";
}

function createDb(connectionString: string): Database {
  const pool = mysql.createPool({
    uri: connectionString,
    connectionLimit: 10,
    timezone: "+08:00",
  });

  // mysql2 的 `connection` 事件在物理连接就绪时触发；SET 会先于该连接上的
  // 后续查询执行，保证 NOW()/CURRENT_TIMESTAMP 统一落在东八区。
  pool.on("connection", (conn) => {
    void conn.query("SET time_zone = '+08:00'");
  });

  return drizzle(pool, { schema, mode: "default" });
}

const globalForDb = globalThis as unknown as { __openDoingDb?: Database };

export const db: Database = globalForDb.__openDoingDb ?? createDb(resolveConnectionString());
globalForDb.__openDoingDb = db;

/**
 * 数据库 client 类型。
 *
 * `MySql2Database` 不包含 `$client` 成员，因此 drizzle 事务 client
 * （MySql2Transaction 继承自 MySqlDatabase）在结构上可直接作为该参数类型传入。
 */
export type DbClient = typeof db;
