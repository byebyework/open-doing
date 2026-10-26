import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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
 */
type Database = PostgresJsDatabase<typeof schema>;

function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;

  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少 DATABASE_URL 环境变量");
  }

  return "postgres://open-doing:open-doing@localhost:5433/open_doing";
}

function createDb(connectionString: string): Database {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

const globalForDb = globalThis as unknown as { __openDoingDb?: Database };

export const db: Database = globalForDb.__openDoingDb ?? createDb(resolveConnectionString());
globalForDb.__openDoingDb = db;

/**
 * 数据库 client 类型。
 *
 * `PostgresJsDatabase` 不包含 `$client` 成员，因此 drizzle 事务 client
 * （PgTransaction 继承自 PgDatabase）在结构上可直接作为该参数类型传入。
 */
export type DbClient = typeof db;
