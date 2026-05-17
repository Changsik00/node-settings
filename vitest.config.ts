import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      // istanbul is slower than v8 but reports per-file coverage
      // correctly when the same module is loaded via multiple
      // import paths (direct + transitive). v8's tracking aggregates
      // those incorrectly and under-reports.
      provider: "istanbul",
      reporter: ["text", "lcov", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        // Test files themselves and their snapshots
        "src/**/*.test.ts",
        "src/**/__snapshots__/**",
        // CLI bin shim — exercised by verify-dist after build, not unit tests
        "src/cli/bin.ts",
        // Re-export-only index files have no executable code
        "src/loaders/index.ts",
        "src/generators/index.ts",
      ],
      thresholds: {
        // Floors set slightly below current measured coverage so a
        // small regression bothers the PR author. Raise as coverage
        // improves; don't lower without discussion.
        lines: 80,
        functions: 85,
        statements: 80,
        branches: 80,
      },
    },
  },
});
