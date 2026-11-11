#!/usr/bin/env node
/**
 * 生产/容器环境的数据库迁移入口。
 *
 * 与 `pnpm db:migrate`（drizzle-kit，devDependency）不同，本脚本只依赖
 * 运行时依赖 `drizzle-orm` + `postgres`，因此可以跑在不含 devDependencies
 * 的生产镜像里。迁移语义与 drizzle-kit 相同：读取 `apps/web/drizzle/`
 * 的 journal，逐条重放未应用的迁移（幂等，可安全地在每次部署时执行）。
 *
 * 由 Dockerfile 的 entrypoint 在启动 Next.js 之前调用；设
 * `SKIP_DB_MIGRATION=1` 可跳过（例如由外部 Job/init container 统一迁移）。
 *
 * 环境变量：
 * - DATABASE_URL（必填）：目标数据库连接串（生产库，绝非 TEST_DATABASE_URL）。
 * - MIGRATE_MAX_RETRIES（可选，默认 30）：数据库连接失败时的重试次数（每次间隔 2s），
 *   用于容器编排中 web 与 postgres 同时启动的场景；迁移 SQL 本身的错误不重试。
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set; refusing to guess the target database");
  process.exit(1);
}

const MAX_RETRIES = Number(process.env.MIGRATE_MAX_RETRIES || 30);
const RETRY_DELAY_MS = 2000;

// 单连接即可；若部署环境经事务模式连接池代理（PgBouncer 等）访问，
// 与 src/server/db/client.ts 的约定一致：需在连接串里关闭 prepared statements。
const client = postgres(url, { max: 1, connect_timeout: 5 });
const db = drizzle(client);

/** 仅连接类错误才值得重试；迁移 SQL 的错误应立即失败并暴露出来。 */
function isConnectError(err) {
  return (
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(err?.code) ||
    err?.code === "57P03" || // cannot_connect_now（数据库正在启动）
    err?.code === "53300" // too_many_connections
  );
}

try {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      break;
    } catch (err) {
      if (!isConnectError(err) || attempt >= MAX_RETRIES) {
        throw err;
      }
      console.warn(
        `[migrate] database not reachable (attempt ${attempt}/${MAX_RETRIES}: ${err.code ?? err.message}); retrying in ${RETRY_DELAY_MS}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  console.log("[migrate] database schema is up to date");
} catch (err) {
  console.error("[migrate] migration failed:", err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
