import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit 配置。
 *
 * 迁移只针对 `DATABASE_URL`（应用开发库）；`TEST_DATABASE_URL` 仅由数据库测试的
 * `testing.ts` 通过 migrator 使用，这里不读取它，避免误迁移测试库。
 * `pnpm --filter @open-doing/web db:generate | db:migrate` 均读取本文件。
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgres://open-doing:open-doing@localhost:5432/open_doing",
  },
});
