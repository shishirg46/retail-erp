// Frontend test configuration (D22.6).
//
// Separate from vitest.config.ts (the backend F-15 gate, node environment):
// component tests need jsdom + React Testing Library + user-event, and pure
// frontend units (lib/format, lib/validate, stores, nav config) live here too.
// These suites never touch the database and may run in parallel.

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
    css: false,
  },
});
