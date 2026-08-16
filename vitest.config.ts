// Vitest configuration for the F-15 regression gate.
//
//   - node environment: every suite exercises services/repositories/routes;
//     no DOM is needed.
//   - fileParallelism: false — all DB-touching suites share the single
//     `erp_retail_test` database and truncate all tables between tests, so
//     test files must never overlap.
//   - Wide timeouts because the HTTP suites spawn a real Next.js dev server
//     (cold starts can take a couple of minutes).
//   - setupFiles: loads `.env` via dotenv before any suite runs. The
//     erp_retail_test-only guard lives in tests/helpers/db.ts and fails fast
//     (throws) from every DB-touching suite.

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/frontend/**"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});