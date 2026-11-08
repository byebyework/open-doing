/**
 * 注册码管理脚本（封测）：生成 / 查看注册码。
 *
 * 用法（先加载环境变量：`set -a; source apps/web/.env.local; set +a`）：
 * - `pnpm register-codes 10`    生成 10 个注册码并逐行打印
 * - `pnpm register-codes --list` 查看已有注册码的使用情况
 *
 * 仅读取 `DATABASE_URL`（开发库），绝不触碰测试库 / e2e 库；码的生成与
 * 消费逻辑复用 features/auth/registration-codes（有单元测试覆盖）。
 * 生成与写入不在同一事务也无需回滚：码只是尚未发放的名额，多生成可以
 * 用 `--list` 观察后弃用（不再分发即可）。
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import {
  generateRegistrationCodes,
  listRegistrationCodes,
} from "../../features/auth/registration-codes";
import * as schema from "./schema";

const USAGE = "Usage: pnpm register-codes <count 1-100> | pnpm register-codes --list";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL; load env first: set -a; source apps/web/.env.local; set +a");
  }

  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 5, timezone: "+08:00" });
  try {
    const db = drizzle(pool, { schema, mode: "default" });
    const arg = process.argv[2];

    if (arg === "--list") {
      const codes = await listRegistrationCodes(db);
      if (codes.length === 0) {
        console.log("No registration codes yet. Generate some with: pnpm register-codes 10");
        return;
      }
      console.log("CODE      USED/MAX   CREATED_AT");
      for (const entry of codes) {
        const exhausted = entry.usedCount >= entry.maxUses ? "  (exhausted)" : "";
        console.log(
          `${entry.code}  ${String(entry.usedCount).padStart(4)}/${entry.maxUses}` +
            `   ${entry.createdAt.toISOString()}${exhausted}`,
        );
      }
      return;
    }

    const count = Number(arg);
    if (!arg || !Number.isInteger(count) || count < 1 || count > 100) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }

    const codes = await generateRegistrationCodes(count, db);
    console.log(`Generated ${count} registration code(s):`);
    for (const code of codes) {
      console.log(code);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("[register-codes] failed:", error);
  process.exitCode = 1;
});
