import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // 数据库用例共用同一个 TEST_DATABASE_URL，且 setupTestDb() 会 TRUNCATE 全表：
    // 多文件并行会互相清空数据，因此串行执行测试文件。
    fileParallelism: false,
    projects: [
      { test: { name: "types", include: ["packages/types/src/**/*.test.ts"], environment: "node" } },
      {
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") } },
        test: { name: "web", include: ["apps/web/src/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
