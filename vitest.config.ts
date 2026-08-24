import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // This gate covers only deterministic modules verified at 100% by the
      // unit suite. Agent/eval paths still have meaningful uncovered cases;
      // provider/model orchestration also requires external runtime seams.
      include: [
        "src/generators/index.ts",
        "src/generators/rng.ts",
        "src/lib/codes/index.ts",
        "src/lib/utils.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
