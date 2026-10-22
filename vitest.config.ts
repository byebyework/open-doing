import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "types", include: ["packages/types/src/**/*.test.ts"], environment: "node" } },
      {
        resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") } },
        test: { name: "web", include: ["apps/web/src/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
