import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit 配置。
 *
 * 开发迁移使用 DATABASE_URL；未设置时回退到 TEST_DATABASE_URL（便于在测试库上验证迁移）。
 * `pnpm --filter @open-doing/web db:generate | db:migrate` 均读取本文件。
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      process.env.TEST_DATABASE_URL ||
      "postgres://open-doing:open-doing@localhost:5432/open_doing",
  },
});
