import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__test__/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reportsDirectory: "coverage",
      reporter: ["text", "text-summary", "html"],
    },
  },
});
