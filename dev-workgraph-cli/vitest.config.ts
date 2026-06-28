import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__test__/**/*.test.ts"],
    environment: "node",
    // vitest 4 narrowed restoreAllMocks() to spies only; clear mock call
    // history between tests so suites don't see calls leak across tests.
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reportsDirectory: "coverage",
      reporter: ["text", "text-summary", "html", "lcov"],
    },
  },
});
